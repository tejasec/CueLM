import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const manifest=path.join(root,'src-tauri/Cargo.toml');
const binary=path.join(root,'src-tauri/target/debug',process.platform==='win32'?'cuelm.exe':'cuelm');
function cargo(args,env=process.env){
  const result=spawnSync('cargo',args,{cwd:root,stdio:'inherit',env});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
cargo(['build','--manifest-path',manifest,'--bin','cuelm']);
cargo(['test','--manifest-path',manifest,'mcp::tests::packaged_helper_stdio_roundtrip','--','--ignored','--nocapture'],{...process.env,HELIX_MCP_HELPER_BIN:binary});
