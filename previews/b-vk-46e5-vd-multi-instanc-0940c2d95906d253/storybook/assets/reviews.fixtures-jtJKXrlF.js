import{h as I,n as $}from"./host-BvVI7sr9.js";function j(t,s){const r=new URLSearchParams({connection:t.connectionId,repository:t.repository,workspace:t.workspace});return s&&(r.set("version",s.pin.version),r.set("snapshot",s.pin.snapshot)),`#/reviews${s?`/${s.request.request_id}`:""}?${r}`}function R(t,s,r,n="rendered-markdown"){const o=r.kind==="document"?r.target:r.dsl;return{elementId:`review:${s.request.request_id}:${r.id}`,label:r.label,uiPath:["Reviews",s.request.title,r.label],featureId:"reviews.member",representation:n,resource:{kind:"document",id:`${o.version}:${o.resource}`,repository:t.repository,workspace:t.workspace,path:o.resource,revision:o.version}}}function D(t,s,r){return r.map(n=>{const o=s.request.members.find(a=>a.id===n.member_id);if(!o)throw new Error("Saved comment refers to another review request.");return{id:n.id,version:n.version??1,kind:n.kind??"content-comment",comment:n.text,context:{target:R(t,s,o,n.selection?.representation),selection:n.selection??null,capturedAt:n.captured_at??"",appBuild:n.app_build??""}}})}function U(t,s,r){return r.map(n=>{const o=s.request.members.find(p=>R(t,s,p).elementId===n.context.target.elementId);if(!o)throw new Error("Comment belongs to another review request.");const{pageUrl:a,...u}=n.context;return{id:n.id,version:n.version,member_id:o.id,text:n.comment,kind:n.kind,selection:u.selection?{...u.selection,ranges:u.selection.ranges?.map(p=>({...p}))}:null,captured_at:u.capturedAt,app_build:u.appBuild}})}function E(t,s){return s.filter(r=>r.value.kind==="review-response"&&r.value.request.id===t.request.request_id&&r.value.request.version===t.pin.version)}function X(t,s,r){if(t.request.status!=="published")return t.request.status==="draft"?"Draft":"Withdrawn";const n=E(t,s).filter(a=>!r||a.value.reviewer===r),o=t.request.members.filter(a=>a.kind==="form");return n.length&&o.every(a=>n.some(u=>u.value.forms.some(p=>p.member_id===a.id)))?"Responded":n.length?"Partially responded":s.some(a=>a.value.kind==="review-draft"&&(!r||a.value.reviewer===r)&&a.value.request.id===t.request.request_id&&a.value.request.version===t.pin.version)?"In review":"Needs response"}const g={connectionId:"a6075abf-226e-4c88-977c-e11404e59f32",installationId:1,repository:"example/storage",workspace:"reader-workspace"},w=(t,s)=>({resource:t,version_kind:"git-blob",version:s.repeat(40),snapshot:"1".repeat(40)}),k=w("threads/task-reader/plan.md","a"),v=w("threads/task-reader/plan.md","b"),q=w("forms/reader.json","c"),S=w("forms/review.json","d"),N=`# Reader plan

The full target document is pinned to this packet.

## Changes

Remote drafts survive reopening.
`,C=`# Reader plan

The baseline had browser-only drafts.
`,y=(t,s)=>JSON.stringify({format:"standard",id:t,task_id:"task-reader",title:s,goal:"Choose the next steps for this implementation.",questions:[{id:"decision",type:"choices",title:"Next steps",description:"The author suggests selecting one option. You can choose multiple.",choices:[{id:"keep",label:"Keep this approach",description:"Continue with the implementation shown in the pinned document.",is_recommended_reason:"Preserves the reviewed scope.",prosAndCons:{pros:["Retains the verified behavior"],cons:["Defers broader improvements"]}},{id:"revise",label:"Revise this approach",description:"Use your notes to describe the changes you want."}],choiceGroups:[{id:"suggested-choice",title:"Single select question",mode:t==="reader_decisions"?"exactlyOne":"atMostOne",choiceIds:["keep","revise"]}]},{id:"additional_notes",type:"textarea",title:"Additional notes"}]}),T=new Map([[k.version,N],[v.version,C],[q.version,y("reader_decisions","Reader decisions")],[S.version,y("review_feedback","Review experience feedback")]]),J={path:"threads/task-reader/plan.md",before:`# Reader plan

Keep **local drafts** in this [workspace][guide].

## Next steps

- Save in the browser
- Reopen this tab

| Storage | Lifetime |
| --- | --- |
| Local | One tab |

> This warning was removed.

\`\`\`ts
const storage = "local";
\`\`\`

\`\`\`mermaid
flowchart LR
  Draft --> Review
\`\`\`

[guide]: https://example.com/guide
`,after:`# Reader plan

Keep **remote drafts** in this [workspace][guide].

## Next steps

- Save remotely
- Reopen any tab

| Storage | Lifetime |
| --- | --- |
| Remote | Persistent |

\`\`\`ts
const storage = "remote";
\`\`\`

## Added section

Read the *updated* guidance. [Unsafe](javascript:alert(1))

<script>window.markdownDiffInjected = true<\/script>

\`\`\`mermaid
flowchart LR
  Draft --> Review
\`\`\`

[guide]: https://example.com/guide
`};function L({remote:t=!1,missingBaseline:s=!1,comparison:r,process:n=!1,picker:o=!1,deferConnection:a=!1}={}){let u={artifacts:[],revision:1,missingBaseline:s};const p=async(i,e="state",d)=>{if(!t)return u;const c=await fetch("/__review-fixture",{headers:{"X-Review-Operation":e,...d?{"X-Review-Request":d}:{},...i?{"X-Review-Resource":JSON.stringify(i)}:{}}});if(!c.ok)throw new Error(`HTTP ${c.status}: ${await c.text()}`);return c.json()},P=async i=>{if(!t){u=i;return}const e=await fetch("/__review-fixture",{method:"POST",body:JSON.stringify(i)});if(!e.ok)throw new Error(`HTTP ${e.status}: ${await e.text()}`)};function h(i,e){const d={kind:"review-request",schema_version:1,request_id:i,revision_id:`revision-${e}`,workspace:g.workspace,bead_id:"task-reader",related_beads:[],thread:"threads/task-reader",title:i==="reader-01"?"Reader follow-up":"Independent reader review",purpose:"Review the pinned reader plan and two forms.",question:e===1?"What should we do next?":"Updated question: which changes should we make?",status:"published",change_kind:"implemented",members:[{id:"plan",kind:"document",label:"Reader plan",target:{...k,resource:r?.path??k.resource},baseline:{...v,resource:r?.path??v.resource}},{id:"reader",kind:"form",label:"Reader decisions",bead_id:"task-reader",form_id:"reader_decisions",dsl:q},{id:"experience",kind:"form",label:"Review experience",bead_id:"task-reader",form_id:"review_feedback",dsl:S}]};return n&&(d.process={kind:"qrspi",id:"hosted-pilot",workspace_ref:"nugs://workspace/reader-workspace",thread_id:d.thread,config:w("threads/task-reader/config.md","9")}),{request:d,pin:{resource:`review-requests/${i}/request.json`,version_kind:"git-blob",version:(e===1?"e":"f").repeat(40),snapshot:"1".repeat(40)}}}const _=async(i,e)=>{if(e.resource.endsWith("/config.md"))return`---
pipeline: full
route: [goals, questions, research, design, plan, implement]
---
`;if((await p(e)).missingBaseline&&e.version===v.version)throw new Error("Historical baseline is unavailable.");if(r&&e.version===k.version)return r.after;if(r&&e.version===v.version)return r.before;const d=T.get(e.version);if(d===void 0)throw new Error("Pinned resource unavailable.");return d};return{contractVersion:1,modules:{documents:{version:1,connect:async()=>(a&&await fetch("/__review-connect-fixture"),[{id:g.connectionId,name:"Fixture reviewer",installationId:1,account:"example"},...o?[{id:"b6075abf-226e-4c88-977c-e11404e59f32",name:"Second reviewer",installationId:2,account:"second"}]:[]]),repositories:async i=>o?(await fetch("/__review-picker-fixture",{headers:{"X-Picker-Operation":"repositories","X-Picker-Connection":i}})).json():[{fullName:g.repository,private:!0}],discover:async i=>o?(await fetch("/__review-picker-fixture",{headers:{"X-Picker-Operation":"workspaces","X-Picker-Connection":i.connectionId,"X-Picker-Repository":i.repository}})).json():[{id:g.workspace,hasDocuments:!0}],open:async()=>{throw new Error("Use review fixture transport.")},read:async()=>"",dispose(){}},reviews:{async list(i,e){const d=await p(void 0,"list",e),c=[h("reader-01",d.revision),h("reader-02",1)];if(d.nextCheckpoint){const f=h("reader-03",1);f.request.previous_request="reader-01",f.request.title="Next Goals checkpoint",c.push(f)}return{requests:c.filter(f=>!e||f.request.request_id===e),artifacts:d.artifacts,reviewer:"github:1",acknowledgements:[]}},async progress(){const i=await p(void 0,"progress");if(i.workflowError)throw Error("Actions unavailable");return i.workflow??{state:"unknown",checked_at:new Date().toISOString(),message:"Fixture workflow progress unavailable."}},async open(i,e){return await p(void 0,"open",e.resource.split("/")[1]),h(e.resource.split("/")[1],e.version==="f".repeat(40)?2:1)},read:_,async current(i,e){return e.endsWith("/config.md")?{pin:w(e,"9"),text:`---
pipeline: full
route: [goals, questions, research, design, plan, implement]
---
`}:{pin:w(e,"8"),text:`---
status: draft
phase: design
---
`}},async save(i,e,d){const c=await p();if(c.failSecond&&e.kind==="review-response"&&e.forms.some(l=>l.member_id==="experience"))throw new Error("Second form transport unavailable. Your first form receipt is retained.");const f=h(e.request.id,e.request.version==="f".repeat(40)?2:1).request;await I(f,e,l=>_(i,l));const b=$(e),m=c.artifacts.find(l=>l.pin.resource===b);if(m&&JSON.stringify(m.value)===JSON.stringify(e))return{...m.pin,reviewer:e.reviewer,...n?{dispatch:{state:"dispatched",message:"Dispatch accepted; start unknown."}}:{}};if((m?.pin.version??null)!==d)throw new Error("Review save conflict. Reload the remote draft.");const O=[...new Uint8Array(await crypto.subtle.digest("SHA-1",new TextEncoder().encode(JSON.stringify(e))))].map(l=>l.toString(16).padStart(2,"0")).join(""),x={value:e,pin:{resource:b,version_kind:"git-blob",version:O,snapshot:"2".repeat(40)}};return await P({...c,artifacts:[...c.artifacts.filter(l=>l.pin.resource!==b),x]}),{...x.pin,reviewer:e.reviewer,...n&&e.kind==="review-response"?{dispatch:c.workflow?.dispatch??{state:"failed",message:"Missing installed-source Actions write route. Response is saved."}}:{}}}}}}}export{X as a,j as b,L as c,J as d,D as e,E as f,R as g,g as r,U as s};
