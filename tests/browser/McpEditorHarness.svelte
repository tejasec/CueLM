<script lang="ts">
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import Editor from '../../src/lib/components/Editor.svelte';
	import { appConfig, activeNote, activeNotePath, editorDirty, readOnly, sourceMode } from '../../src/lib/stores/app';
	import { editorMode, selectEditorMode } from '../../src/lib/editor/mode';
	import { createMcpWindowGate, mcpBusy } from '../../src/lib/utils/mcp-editor';
	import type { AppConfig, NoteContent } from '../../src/lib/types';
	let editor=$state<Editor>();
	let note:NoteContent={path:'/vault/Note.md',meta:{id:'stable-id',title:'Note',tags:[],pinned:false,created:'2026-01-01T00:00:00Z',modified:'2026-01-01T00:00:00Z'},content:'# Note\n\nOriginal body',raw:'---\nid: stable-id\ntitle: Note\ntags: []\npinned: false\ncreated: 2026-01-01T00:00:00Z\nmodified: 2026-01-01T00:00:00Z\n---\n# Note\n\nOriginal body\n'};
	appConfig.set({active_vault:'/vault',vaults:[{path:'/vault',name:'Work'}],enable_wiki_links:false,hide_title_in_body:false,title_mode:'input',show_line_numbers:false,default_view_mode:true,new_note_editor_mode:'rich'} as AppConfig);
	activeNote.set(structuredClone(note));activeNotePath.set(note.path);editorDirty.set(false);sourceMode.set(true);
	const calls:{command:string;args:any}[]=[];
	(window as any).__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
		calls.push({command,args});
		if(command==='plugin:event|listen')return 1;
		if(command.startsWith('plugin:event|')||command.startsWith('plugin:window|'))return;
		if(command==='read_note')return structuredClone(note);
		if(command==='save_note'){
			if(args.expectedRaw!==note.raw)throw 'Save conflict';
			note={...note,meta:args.meta,content:args.body,raw:note.raw.split('---\n').slice(0,2).join('---\n')+'---\n'+args.body};return structuredClone(note);
		}
		throw Error(`Unexpected command: ${command}`);
	};
	const busyValues:boolean[]=[];mcpBusy.subscribe(value=>busyValues.push(value));
	const replies:{id:string;accepted:boolean}[]=[];
	const gate=createMcpWindowGate({ready:()=>!!editor,reply:async(id,accepted)=>{replies.push({id,accepted});}});
	let initialized=false;
	$effect(()=>{if(editor&&!initialized){initialized=true;editor.loadNote(note.path,note.content);void tick().then(()=>{readOnly.set(false);});}});
	Object.assign(window,{mcpEditorFixture:{
		emptyUntitled:async()=>{note={...note,meta:{...note.meta,title:'Untitled'},content:'',raw:note.raw.slice(0,note.raw.indexOf('\n---\n')+5).replace('title: Note','title: Untitled')};activeNote.set(structuredClone(note));editor?.loadNote(note.path,'');await tick();selectEditorMode('live');readOnly.set(false);await tick();},
		pinDisk:()=>{note={...note,meta:{...note.meta,pinned:true},raw:note.raw.replace('pinned: false','pinned: true')};},
		save:()=>editor?.flushSave(),prepare:(id:string)=>gate.prepare(id),finish:(id:string)=>gate.finish({id,vaultPath:'/vault',path:note.path}),
		changeDisk:(body:string)=>{note={...note,content:body,raw:note.raw.slice(0,note.raw.indexOf('\n---\n')+5)+body};},
		snapshot:()=>({body:editor?.getCurrentBody(),raw:editor?.getAcceptedRaw(),busy:get(mcpBusy),busyValues:[...busyValues],dirty:get(editorDirty),readonly:get(readOnly),mode:get(editorMode),pending:editor?.isMutationPending(),replies:[...replies],calls:[...calls]}),
	}});
</script>
<main inert={$mcpBusy}><Editor bind:this={editor}/></main>
<style>
	:global(:root){--bg-primary:#fff;--bg-secondary:#f3f5f7;--bg-hover:#e7edf0;--text-primary:#20252b;--text-secondary:#626e79;--text-tertiary:#79838d;--accent:#276e68;--accent-hover:#1f5e59;--border-color:#ced6dc;--border-light:#e4e9ed;--editor-font-size:16px;--editor-line-height:1.6;}
	:global(body){margin:0;font-family:sans-serif;color:var(--text-primary);background:var(--bg-primary);}main{height:100vh;}
</style>
