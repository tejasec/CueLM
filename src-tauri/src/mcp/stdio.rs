use super::{
    bridge, knowledge,
    policy::{self, Access, Connection},
};
use rmcp::{
    model::*, service::RequestContext, ErrorData as McpError, RoleServer, ServerHandler, ServiceExt,
};
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Clone)]
struct Helper {
    connection: PathBuf,
}
impl Helper {
    fn connection(&self) -> Result<Connection, String> {
        let connection:Connection=serde_json::from_slice(&policy::bounded_read(&self.connection,8192,true)?).map_err(|_|"Invalid MCP connection file. Copy a new configuration from HelixNotes Settings → Integrations.")?;
        if connection.mode == Access::Off {
            return Err(
                "MCP access is disabled. Enable it in HelixNotes Settings → Integrations.".into(),
            );
        }
        Ok(connection)
    }
    fn definitions(&self) -> Result<Vec<Tool>, String> {
        knowledge::tools(self.connection()?.mode == Access::Write)
            .into_iter()
            .map(|value| {
                serde_json::from_value(value).map_err(|_| "Invalid built-in tool schema.".into())
            })
            .collect()
    }
}
impl ServerHandler for Helper {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("cuelm", env!("CARGO_PKG_VERSION")))
        .with_instructions(knowledge::INSTRUCTIONS)
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let tools = self.definitions().map_err(|_| {
            McpError::internal_error(
                "MCP access is unavailable. Reconnect from HelixNotes Settings → Integrations.",
                None,
            )
        })?;
        Ok(ListToolsResult {
            tools,
            ..Default::default()
        })
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.definitions()
            .ok()?
            .into_iter()
            .find(|tool| tool.name == name)
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let args = Value::Object(request.arguments.unwrap_or_default());
        let result=async{
            let connection=self.connection()?;
            if request.name=="get_feature_guide"{
                let topic=args.get("topic").and_then(Value::as_str).ok_or("Choose a feature-guide topic.")?;
                let (_,markdown)=knowledge::guides().into_iter().find(|(name,_)|*name==topic).ok_or("Unknown feature guide.")?;
                return Ok(json!({"topic":topic,"markdown":markdown,"writeToolsAvailable":connection.mode==Access::Write}));
            }
            if request.name=="edit_note"&&connection.mode!=Access::Write{return Err("Editing is disabled for this vault. Enable it explicitly in HelixNotes Settings → Integrations and reconnect your MCP client.".into());}
            if !knowledge::tools(connection.mode==Access::Write).iter().any(|tool|tool["name"].as_str()==Some(request.name.as_ref())){return Err("Unknown or unauthorized MCP tool.".into());}
            bridge::call(&connection,&request.name,args).await
        }.await;
        Ok(match result {
            Ok(value) => CallToolResult::structured(value),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
        }
        .into())
    }
    async fn list_resources(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        let mut resources:Vec<Value>=knowledge::guides().iter().map(|(topic,_)|json!({"uri":format!("helixnotes://guide/{topic}"),"name":format!("guide-{topic}"),"title":format!("HelixNotes: {topic}"),"mimeType":"text/markdown"})).collect();
        resources.push(json!({"uri":"helixnotes://schema/frontmatter","name":"frontmatter-schema","title":"HelixNotes frontmatter schema","mimeType":"application/schema+json"}));
        serde_json::from_value(json!({"resources":resources}))
            .map_err(|_| McpError::internal_error("Invalid built-in resource metadata.", None))
    }
    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        let (mime, text) = if request.uri == "helixnotes://schema/frontmatter" {
            (
                "application/schema+json",
                serde_json::to_string_pretty(&knowledge::schema()).unwrap(),
            )
        } else {
            let prefix = "helixnotes://guide/";
            let topic = request
                .uri
                .strip_prefix(prefix)
                .ok_or_else(|| McpError::resource_not_found("Unknown resource.", None))?;
            let (_, text) = knowledge::guides()
                .into_iter()
                .find(|(name, _)| *name == topic)
                .ok_or_else(|| McpError::resource_not_found("Unknown resource.", None))?;
            ("text/markdown", text)
        };
        let result: ReadResourceResult = serde_json::from_value(
            json!({"contents":[{"uri":request.uri,"mimeType":mime,"text":text}]}),
        )
        .map_err(|_| McpError::internal_error("Invalid resource response.", None))?;
        Ok(result.into())
    }
}

pub fn run_cli_if_requested() -> bool {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if !args.iter().any(|arg| arg == "--mcp-stdio") {
        return false;
    }
    let result = (|| {
        if args.len() != 3 || args[0] != "--mcp-stdio" || args[1] != "--connection" {
            return Err("Usage: helixnotes --mcp-stdio --connection /absolute/path/from/client/configuration".to_string());
        }
        let path = PathBuf::from(&args[2]);
        if !path.is_absolute() {
            return Err(
                "Use the absolute connection path generated by HelixNotes Settings → Integrations."
                    .into(),
            );
        }
        let _ = rustls::crypto::ring::default_provider().install_default();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|_| "Could not start the MCP helper.")?;
        let result = runtime.block_on(async {
            let helper = Helper { connection: path };
            let connection = helper.connection()?;
            bridge::call(&connection, "health", json!({})).await?;
            let (input, output) = rmcp::transport::io::stdio_pipes();
            let transport = rmcp::transport::async_rw::AsyncRwTransport::new(input, output)
                .with_max_line_length(8 * 1024 * 1024);
            let service = helper
                .serve(transport)
                .await
                .map_err(|_| "MCP initialization failed.")?;
            service
                .waiting()
                .await
                .map_err(|_| "MCP connection closed unexpectedly.")?;
            Ok::<_, String>(())
        });
        runtime.shutdown_timeout(std::time::Duration::from_secs(1));
        result
    })();
    if let Err(error) = result {
        eprintln!("HelixNotes MCP: {error}");
        std::process::exit(1);
    }
    true
}
