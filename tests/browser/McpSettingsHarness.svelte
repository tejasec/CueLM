<script lang="ts">
	import SettingsPanel from '../../src/lib/components/SettingsPanel.svelte';
	import { appConfig, showSettings, settingsTab, theme } from '../../src/lib/stores/app';
	import { applyLanguage } from '../../src/lib/i18n';
	import type { AppConfig } from '../../src/lib/types';
	let mode='off', fail=false, confirmed=false, hold=false, release:(()=>void)|null=null;
	const modes=new Map<string,string>(); let offlineOther=false;
	let clipboard='';const calls:{command:string;args:any}[]=[];
	let narrow=$state(false), dark=$state(false);
	appConfig.set({active_vault:'/notes/Private Project',active_bookmark_id:null,vaults:[{path:'/notes/Private Project',name:'Private Project'}],language:'en',theme:'light',enable_wiki_links:false} as AppConfig);
	showSettings.set(true);settingsTab.set('integrations');
	(window as any).__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
		calls.push({command,args});
		if(command==='plugin:app|version')return '1.3.8';
		if(command==='plugin:event|listen')return 1;
		if(command.startsWith('plugin:event|')||command.startsWith('plugin:window|'))return;
		if(command==='mcp_status'){
			const selected=modes.get(args.vault.path)??'off';
			if(args.vault.path==='/offline/Archive'&&offlineOther&&selected!=='off')return {mode:selected,ready:false,error:'Storage unavailable. You can still disable access.'};
			return {mode:selected,ready:selected!=='off'};
		}
		if(command==='plugin:dialog|confirm')return confirmed;
		if(command==='mcp_set_access'){
			if(hold)await new Promise<void>(resolve=>{release=resolve;});
			if(fail)throw 'Could not persist MCP permissions';
			modes.set(args.vault.path,args.mode);mode=modes.get('/notes/Private Project')??'off';return {mode:args.mode,ready:args.mode!=='off'};
		}
		if(command==='mcp_client_config')return {mcpServers:{helixnotes:{command:'/opt/HelixNotes/helixnotes',args:['--mcp-stdio','--connection','/home/user/.config/helixnotes/mcp/opaque-id.json']}}};
		if(command==='copy_text_to_clipboard'){clipboard=args.text;return;}
		throw Error(`Unexpected command: ${command}`);
	};
	$effect(()=>{document.documentElement.dataset.mcpDark=String(dark);});
	Object.assign(window,{mcpSettingsFixture:{install:async()=>{const {installMcpWindow}=await import('../../src/lib/mcp');const dispose=await installMcpWindow(()=>true);dispose();},snapshot:()=>({mode,modes:Object.fromEntries(modes),activeVault:'/notes/Private Project',calls:[...calls],clipboard}),confirm:(value:boolean)=>{confirmed=value;},fail:(value:boolean)=>{fail=value;},hold:()=>{hold=true;},release:()=>release?.(),offlineOther:()=>{offlineOther=true;modes.set('/offline/Archive','write');appConfig.update(config=>({...config!,vaults:[...config!.vaults,{path:'/offline/Archive',name:'Archive'}]}));},narrow:()=>{narrow=true;},dark:()=>{dark=!dark;theme.set(dark?'dark':'light');},language:applyLanguage}});
</script>
{#if narrow}<main>{#await import('../../src/lib/components/McpSettings.svelte') then {default:McpSettings}}<McpSettings/>{/await}</main>{:else}<SettingsPanel onBeforeVaultSwitch={async()=>true}/>{/if}
<style>
	:global(:root){--bg-primary:#fff;--bg-secondary:#f3f5f7;--bg-tertiary:#e8edf0;--bg-hover:#e7edf0;--text-primary:#20252b;--text-secondary:#626e79;--text-tertiary:#79838d;--accent:#276e68;--accent-light:#dfefeb;--border-color:#ced6dc;--border-light:#e4e9ed;--shadow-lg:0 14px 40px #0003;}
	:global(:root[data-mcp-dark='true']){--bg-primary:#182027;--bg-secondary:#222d36;--bg-tertiary:#303d48;--bg-hover:#303d48;--text-primary:#e5eaf0;--text-secondary:#a1acb8;--text-tertiary:#8b99a6;--border-color:#3c4b58;--border-light:#35434f;}
	:global(body){margin:0;font-family:monospace;background:var(--bg-primary);color:var(--text-primary);}main{padding:20px;max-width:420px;}
</style>
