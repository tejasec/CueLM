<script lang="ts">
	import { get } from 'svelte/store';
	import { untrack } from 'svelte';
	import { applyLanguage } from '../../src/lib/i18n';
	import NewNoteEditorSetting from '../../src/lib/components/NewNoteEditorSetting.svelte';
	import { newNoteEditorMode, selectEditorMode, editorMode, type EditorMode } from '../../src/lib/editor/mode';
	import { setNewNoteEditorMode } from '../../src/lib/api';
	let config = $state<{new_note_editor_mode?: EditorMode | null;new_notes_in_source_mode:boolean}>({new_notes_in_source_mode:false});
	let persisted=untrack(()=>JSON.stringify(config)), fail=false, hold=false;
	selectEditorMode('live');
	let release: (()=>void)|null=null;
	const calls: unknown[]=[];
	(window as any).__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
		if(command!=='set_new_note_editor_mode')throw Error(`Unexpected command: ${command}`);
		calls.push({command,args});
		if(hold)await new Promise<void>(resolve=>{release=resolve;});
		if(fail)throw Error('Disk full');
		persisted=JSON.stringify({new_note_editor_mode:args.mode,new_notes_in_source_mode:args.mode!=='rich'});
	};
	async function save(mode:EditorMode){await setNewNoteEditorMode(mode);config=JSON.parse(persisted);}
	Object.assign(window,{preferenceFixture:{
		fail:(value:boolean)=>{fail=value;}, hold:()=>{hold=true;}, release:()=>release?.(),
		legacy:(source:boolean)=>{config={new_notes_in_source_mode:source};persisted=JSON.stringify(config);},
		restart:()=>{config=JSON.parse(persisted);}, language:applyLanguage,
		snapshot:()=>({config:JSON.parse(JSON.stringify(config)),mode:newNoteEditorMode(config),currentEditor:get(editorMode),calls:[...calls]}),
	}});
</script>
<section>
	<NewNoteEditorSetting value={newNoteEditorMode(config)} onchange={save}/>
</section>
<style>
	:global(:root){--bg-primary:#fff;--bg-secondary:#f3f5f7;--bg-hover:#e7edf0;--text-primary:#20252b;--text-secondary:#626e79;--accent:#276e68;--accent-light:#dfefeb;--border-color:#ced6dc;}
	:global(body){margin:0;font-family:sans-serif;background:var(--bg-primary);color:var(--text-primary);}
	section{padding:24px;max-width:420px;}
</style>
