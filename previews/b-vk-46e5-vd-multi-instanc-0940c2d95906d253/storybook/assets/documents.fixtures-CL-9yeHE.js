import{a0 as o}from"./FeedbackAnnotations-D21QX7XC.js";const c=Object.freeze({density:"comfortable",accent:"default"}),i="github-ultimate:document-tree-appearance:v1";async function l(){try{const e=JSON.parse((await o()).getItem(i)??"null");if(e&&["comfortable","compact"].includes(e.density)&&["default","blue","teal"].includes(e.accent))return{density:e.density,accent:e.accent}}catch{}return c}async function m(e){try{const n=await o();n.setItem(i,JSON.stringify(e)),await n.flush()}catch{}}function h(e,n,s,p){return{elementId:`${s}:${n.id}`,label:n.path,uiPath:["Documents","Reader"],featureId:s,representation:p,resource:{kind:"document",id:n.id,path:n.path,repository:e.repository,workspace:e.workspaceId,revision:e.snapshot?.commit}}}const t=Object.freeze({id:"mock-personal",name:"Personal GitHub App",installationId:123,account:"octo-example"}),d=Object.freeze([{id:"product-research",hasDocuments:!0},{id:"release-planning",hasDocuments:!0},{id:"tasks-only",hasDocuments:!1}]),r=Object.freeze({brief:`# Product brief

Explore a **calmer engineering workspace** for humans and agents.

## Goals
- Keep decisions alongside source.
- Make the next action clear.
- Preserve room for long-form research.

| View | Purpose |
| --- | --- |
| Source | Inspect exact document bytes |
| Markdown | Read formatted research |

## Review
- [x] Verify the document snapshot
- [ ] Compare UI candidates

\`\`\`json
{ "workspace": "product-research" }
\`\`\`

This is deterministic Storybook fixture data, not a live GitHub document.`,research:`# Research notes

People want a clear distinction between their workspace, access route, and the document they are reading.

A split-pane layout keeps navigation nearby while leaving space for reading.`,checklist:`# Release checklist

[ ] Review the candidate UI
[ ] Verify keyboard navigation
[ ] Check a narrow viewport
[ ] Promote the selected presentation`,unsafe:`<script>window.__unsafeDocument = true<\/script>

Documents are displayed as text, including this deliberately literal script tag.`,unsafeMarkdown:`# Untrusted Markdown

<script>window.__unsafeDocument = true<\/script>
<img src="https://example.invalid/tracker" onerror="window.__unsafeDocument = true">

[Unsafe link](javascript:alert(1))

**Safe document text**`,config:`{
  "workspace": "product-research",
  "readOnly": true
}`,interview:`# Interview notes

Nested research notes for the document browser.`,planningNotes:`# Planning notes

A different document with the same basename.`}),a=Object.freeze({id:"mock-snapshot",commit:"a1b2c3d4".repeat(5),purpose:"Explore a workspace-first product before choosing source repositories.",documents:[{id:"brief",path:"planning/product-brief.md",size:340},{id:"research",path:"research/interview-notes.md",size:264},{id:"checklist",path:"releases/checklist.md",size:156},{id:"unsafe",path:"examples/literal-html.txt",size:149},{id:"unsafeMarkdown",path:"examples/untrusted.md",size:220},{id:"config",path:"workspace/config.json",size:64},{id:"interview",path:"research/interviews/notes.md",size:70},{id:"planningNotes",path:"planning/notes.md",size:68}]}),f=Object.freeze({connections:[t],connectionId:t.id,repository:"octo-example/workspace-storage",workspaces:d,workspaceId:"product-research",snapshot:a,documentId:"brief",query:"",expandedFolders:["planning"],treeAppearance:c,content:r.brief,documentMode:"markdown",documentFullscreen:!0,busy:!1,status:"Mock document loaded. No extension or GitHub connection is used.",error:null,canDiscover:!0,canBrowse:!0});function w(){return Object.freeze({contractVersion:1,modules:Object.freeze({documents:Object.freeze({version:1,async connect(){return[t]},async discover(){return d},async open(){return a},async read(e,n){if(e!==a.id||!(n in r))throw new Error("Unknown mock document.");return r[n]},dispose(){}})})})}export{h as a,f as b,r as c,c as d,w as e,a as m,l as r,m as s};
