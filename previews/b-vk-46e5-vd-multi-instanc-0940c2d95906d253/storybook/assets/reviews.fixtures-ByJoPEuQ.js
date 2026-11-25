import{n as C,h as N}from"./host-C0UesR6M.js";import{j as f}from"./jsx-runtime-u17CrQMm.js";function D(e,t,r,n="rendered-markdown"){const a=r.kind==="document"?r.target:r.dsl;return{elementId:`review:${t.request.request_id}:${r.id}`,label:r.label,uiPath:["Reviews",t.request.title,r.label],featureId:"reviews.member",representation:n,resource:{kind:"document",id:`${a.version}:${a.resource}`,repository:e.repository,workspace:e.workspace,path:a.resource,revision:a.version}}}function J(e,t,r){return r.map(n=>{const a=t.request.members.find(o=>o.id===n.member_id);if(!a)throw new Error("Saved comment refers to another review request.");return{id:n.id,version:n.version??1,kind:n.kind??"content-comment",comment:n.text,context:{target:D(e,t,a,n.selection?.representation),selection:n.selection??null,capturedAt:n.captured_at??"",appBuild:n.app_build??""}}})}function Q(e,t,r){return r.map(n=>{const a=t.request.members.find(c=>D(e,t,c).elementId===n.context.target.elementId);if(!a)throw new Error("Comment belongs to another review request.");const{pageUrl:o,...p}=n.context;return{id:n.id,version:n.version,member_id:a.id,text:n.comment,kind:n.kind,selection:p.selection?{...p.selection,ranges:p.selection.ranges?.map(c=>({...c}))}:null,captured_at:p.capturedAt,app_build:p.appBuild}})}function O(e,t){return t.filter(r=>r.value.kind==="review-response"&&r.value.request.id===e.request.request_id&&r.value.request.version===e.pin.version)}function $(e,t,r){if(e.request.status!=="published")return e.request.status==="draft"?"Draft":"Withdrawn";const n=O(e,t).filter(o=>!r||o.value.reviewer===r),a=e.request.members.filter(o=>o.kind==="form");return n.length&&a.every(o=>n.some(p=>p.value.forms.some(c=>c.member_id===o.id)))?"Responded":n.length?"Partially responded":t.some(o=>o.value.kind==="review-draft"&&(!r||o.value.reviewer===r)&&o.value.request.id===e.request.request_id&&o.value.request.version===e.pin.version)?"In review":"Needs response"}function E(e,t){return t.artifacts.find(r=>r.value.kind==="review-queue-state"&&r.value.request.id===e.request.request_id&&r.value.reviewer===t.reviewer)}function T(e,t){const r=E(e,t);return r?.value.kind==="review-queue-state"&&r.value.category==="dismissed"?"dismissed":e.request.status==="withdrawn"||$(e,t.artifacts,t.reviewer)==="Responded"?"completed":e.request.status==="draft"?"draft":"active"}function V(e,t,r){return r==="all"||T(e,t)===r}async function K(e,t,r,n,a){const o={kind:"review-queue-state",schema_version:1,transport:"workspace-resources",id:`queue-${crypto.randomUUID()}`,request:{id:n.request.request_id,version:n.pin.version,snapshot:n.pin.snapshot},reviewer:r.reviewer,category:a,forms:[],comments:[],progress:[]},p=E(n,r),c=await e.save(t,o,p?.pin.version??null);if(c.resource!==C(o)||c.reviewer!==r.reviewer)throw new Error("Saved review category receipt does not match this request and reviewer. Refresh the queue.");return{value:o,pin:{resource:c.resource,version_kind:"git-blob",version:c.version,snapshot:c.snapshot}}}function B(e,t){return{...e,artifacts:[...e.artifacts.filter(r=>r.pin.resource!==t.pin.resource),t]}}function M(e,t){const r=new URLSearchParams({connection:e.connectionId,repository:e.repository,workspace:e.workspace});return t&&(r.set("version",t.pin.version),r.set("snapshot",t.pin.snapshot)),`#/reviews${t?`/${t.request.request_id}`:""}?${r}`}const h={queueFilter:{text:"Queue filter"},queueActive:{text:"Active"},queueDismissed:{text:"Dismissed"},queueCompleted:{text:"Completed"},queueAll:{text:"All requests"},dismiss:{text:"Dismiss"},restore:{text:"Restore"},savingCategory:{text:"Saving category…"},allowCodeChanges:{text:"Allow code-file changes for these next steps"},separator:{text:" · "},private:{text:" · private"},inbox:{text:"Review inbox"},requests:{text:"Review requests"},source:{text:"Source and filters"},filters:{text:"Filters"},items:{text:"Review items"},activeItem:{text:"Choose review item"},evidence:{text:"Review evidence"},refresh:{text:"Refresh requests"},empty:{text:"No published requests."},loading:{text:"Loading review requests…"},connection:{text:"Approved connection"},chooseConnection:{text:"Choose a connection"},repository:{text:"Storage repository"},chooseRepository:{text:"Choose a storage repository"},loadingRepositories:{text:"Loading repositories…"},workspace:{text:"Workspace"},chooseWorkspace:{text:"Choose a workspace"},loadingWorkspaces:{text:"Finding workspaces…"},noRepositories:{text:"No repositories available. Check installation access."},noWorkspaces:{text:"No document workspaces found."},reload:{text:"Reload choices"},open:{text:"Open review inbox"},submitted:{text:"Submitted"},reviewed:{text:"Reviewed"},session:{text:"Focused review session"},preview:{text:"Pinned review preview"},requested:{text:"Requested response:"},implemented:{text:"Implemented work"},proposed:{text:"Proposed work"},mixed:{text:"Implemented and proposed work"},exactRevision:{text:"Exact review revision"},reopen:{text:"Reopen this exact packet"},checkUpdates:{text:"Check for updates and receipts"},updated:{text:"Updated packet available."},answersPinned:{text:"Your answers still refer to this revision."},openUpdated:{text:"Open the updated packet separately"},unavailable:{text:"Response submission is unavailable for this packet."},withdrawn:{text:"This request has been withdrawn. Existing responses remain available."},retryContents:{text:"Retry unavailable review contents"},downloading:{text:(e,t)=>`Downloading review contents… ${e} of ${t} finished.`,purpose:"status"},unavailableContents:{text:e=>`${e} review resource(s) unavailable.`,purpose:"error"},hideSidebar:{text:"Hide sidebar"},showSidebar:{text:"Show sidebar"},unsaved:{text:"Unsaved changes. "},saveDraft:{text:"Save draft remotely"},submit:{text:"Submit review feedback"},receipts:{text:"Submission receipts"},forms:{text:" forms"},comments:{text:" comments"},submissionDetails:{text:"Submission details"},exactResponse:{text:"Exact saved response"},snapshot:{text:"snapshot"},responseSaved:{text:"Response saved"},dispatch:{text:"dispatch"},notification:{text:"VK notification"},unknown:{text:"unknown"},missingDelivery:{text:"Delivery evidence is not loaded; retry reconciles the same immutable response without minting answers."},workflowEvidence:{text:"Configured workflow evidence"},openVD:{text:"Open VD workspace"},deliveryChecked:{text:"Delivery checked:"},retryDelivery:{text:"Retry delivery of saved response"},acknowledged:{text:"Task notification acknowledged"},pendingNotification:{text:"Response saved; task notification pending"},restoring:{text:"Restoring saved draft and receipts. Editing is available after restoration."},retryRestoration:{text:"Retry loading saved review state"},recoveredDraft:{text:"Local draft restored. Not submitted."},remoteDraft:{text:"Remote draft restored."},localComments:{text:"Comments saved locally."}};function U({value:e,onChange:t}){return f.jsxs("label",{children:[h.queueFilter.text,f.jsxs("select",{"aria-label":h.queueFilter.text,value:e,onChange:r=>t(r.target.value),children:[f.jsx("option",{value:"active",children:h.queueActive.text}),f.jsx("option",{value:"dismissed",children:h.queueDismissed.text}),f.jsx("option",{value:"completed",children:h.queueCompleted.text}),f.jsx("option",{value:"all",children:h.queueAll.text})]})]})}U.__docgenInfo={description:"",methods:[],displayName:"ReviewQueueFilterView",props:{value:{required:!0,tsType:{name:"union",raw:"'active' | 'dismissed' | 'completed' | 'all'",elements:[{name:"literal",value:"'active'"},{name:"literal",value:"'dismissed'"},{name:"literal",value:"'completed'"},{name:"literal",value:"'all'"}]},description:""}}};const b={connectionId:"a6075abf-226e-4c88-977c-e11404e59f32",installationId:1,repository:"example/storage",workspace:"reader-workspace"},w=(e,t)=>({resource:e,version_kind:"git-blob",version:t.repeat(40),snapshot:"1".repeat(40)}),y=w("threads/task-reader/plan.md","a"),g=w("threads/task-reader/plan.md","b"),P=w("forms/reader.json","c"),j=w("forms/review.json","d"),F=`# Reader plan

The full target document is pinned to this packet.

## Changes

Remote drafts survive reopening.
`,X=`# Reader plan

The baseline had browser-only drafts.
`,S=(e,t)=>JSON.stringify({format:"standard",id:e,task_id:"task-reader",title:t,goal:"Choose the next steps for this implementation.",questions:[{id:"decision",type:"choices",title:"Next steps",description:"The author suggests selecting one option. You can choose multiple.",choices:[{id:"keep",label:"Keep this approach",description:"Continue with the implementation shown in the pinned document.",is_recommended_reason:"Preserves the reviewed scope.",prosAndCons:{pros:["Retains the verified behavior"],cons:["Defers broader improvements"]}},{id:"revise",label:"Revise this approach",description:"Use your notes to describe the changes you want."}],choiceGroups:[{id:"suggested-choice",title:"Single select question",mode:e==="reader_decisions"?"exactlyOne":"atMostOne",choiceIds:["keep","revise"]}]},{id:"additional_notes",type:"textarea",title:"Additional notes"}]}),L=new Map([[y.version,F],[g.version,X],[P.version,S("reader_decisions","Reader decisions")],[j.version,S("review_feedback","Review experience feedback")]]),Y={path:"threads/task-reader/plan.md",before:`# Reader plan

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
`};function G({remote:e=!1,remoteScope:t,missingBaseline:r=!1,comparison:n,process:a=!1,picker:o=!1,deferConnection:p=!1}={}){let c={artifacts:[],revision:1,missingBaseline:r};const m=async(i,s="state",d)=>{if(!e)return c;const u=await fetch("/__review-fixture",{headers:{"X-Review-Operation":s,...t?{"X-Review-Scope":t}:{},...d?{"X-Review-Request":d}:{},...i?{"X-Review-Resource":JSON.stringify(i)}:{}}});if(!u.ok)throw new Error(`HTTP ${u.status}: ${await u.text()}`);return u.json()},A=async i=>{if(!e){c=i;return}const s=await fetch("/__review-fixture",{method:"POST",headers:t?{"X-Review-Scope":t}:{},body:JSON.stringify(i)});if(!s.ok)throw new Error(`HTTP ${s.status}: ${await s.text()}`)};function x(i,s){const d={kind:"review-request",schema_version:1,request_id:i,revision_id:`revision-${s}`,workspace:b.workspace,bead_id:"task-reader",related_beads:[],thread:"threads/task-reader",title:i==="reader-01"?"Reader follow-up":"Independent reader review",purpose:"Review the pinned reader plan and two forms.",question:s===1?"What should we do next?":"Updated question: which changes should we make?",status:"published",change_kind:"implemented",members:[{id:"plan",kind:"document",label:"Reader plan",target:{...y,resource:n?.path??y.resource},baseline:{...g,resource:n?.path??g.resource}},{id:"reader",kind:"form",label:"Reader decisions",bead_id:"task-reader",form_id:"reader_decisions",dsl:P},{id:"experience",kind:"form",label:"Review experience",bead_id:"task-reader",form_id:"review_feedback",dsl:j}]};return a&&(d.process={kind:"qrspi",id:"hosted-pilot",workspace_ref:"nugs://workspace/reader-workspace",thread_id:d.thread,config:w("threads/task-reader/config.md","9")}),{request:d,pin:{resource:`review-requests/${i}/request.json`,version_kind:"git-blob",version:(s===1?"e":"f").repeat(40),snapshot:"1".repeat(40)}}}const q=async(i,s)=>{if(s.resource.endsWith("/config.md"))return`---
pipeline: full
route: [goals, questions, research, design, plan, implement]
---
`;if((await m(s)).missingBaseline&&s.version===g.version)throw new Error("Historical baseline is unavailable.");if(n&&s.version===y.version)return n.after;if(n&&s.version===g.version)return n.before;const d=L.get(s.version);if(d===void 0)throw new Error("Pinned resource unavailable.");return d};return{contractVersion:1,modules:{documents:{version:1,connect:async()=>(p&&await fetch("/__review-connect-fixture"),[{id:b.connectionId,name:"Fixture reviewer",installationId:1,account:"example"},...o?[{id:"b6075abf-226e-4c88-977c-e11404e59f32",name:"Second reviewer",installationId:2,account:"second"}]:[]]),repositories:async i=>o?(await fetch("/__review-picker-fixture",{headers:{"X-Picker-Operation":"repositories","X-Picker-Connection":i}})).json():[{fullName:b.repository,private:!0}],discover:async i=>o?(await fetch("/__review-picker-fixture",{headers:{"X-Picker-Operation":"workspaces","X-Picker-Connection":i.connectionId,"X-Picker-Repository":i.repository}})).json():[{id:b.workspace,hasDocuments:!0}],open:async()=>{throw new Error("Use review fixture transport.")},read:async()=>"",dispose(){}},reviews:{async list(i,s){const d=await m(void 0,"list",s),u=[x("reader-01",d.revision),x("reader-02",1)];if(d.nextCheckpoint){const v=x("reader-03",1);v.request.previous_request="reader-01",v.request.title="Next Goals checkpoint",u.push(v)}return{requests:u.filter(v=>!s||v.request.request_id===s),artifacts:d.artifacts,reviewer:"github:1",acknowledgements:[]}},async progress(){const i=await m(void 0,"progress");if(i.workflowError)throw Error("Actions unavailable");return i.workflow??{state:"unknown",checked_at:new Date().toISOString(),message:"Fixture workflow progress unavailable."}},async open(i,s){return await m(void 0,"open",s.resource.split("/")[1]),x(s.resource.split("/")[1],s.version==="f".repeat(40)?2:1)},read:q,async current(i,s){return s.endsWith("/config.md")?{pin:w(s,"9"),text:`---
pipeline: full
route: [goals, questions, research, design, plan, implement]
---
`}:{pin:w(s,"8"),text:`---
status: draft
phase: design
---
`}},async save(i,s,d){const u=await m();if(u.failSecond&&s.kind==="review-response"&&s.forms.some(l=>l.member_id==="experience"))throw new Error("Second form transport unavailable. Your first form receipt is retained.");const v=x(s.request.id,s.request.version==="f".repeat(40)?2:1).request;await N(v,s,l=>q(i,l));const R=C(s),k=u.artifacts.find(l=>l.pin.resource===R);if(k&&JSON.stringify(k.value)===JSON.stringify(s))return{...k.pin,reviewer:s.reviewer,...a?{dispatch:{state:"dispatched",message:"Dispatch accepted; start unknown."}}:{}};if((k?.pin.version??null)!==d)throw new Error("Review save conflict. Reload the remote draft.");const I=[...new Uint8Array(await crypto.subtle.digest("SHA-1",new TextEncoder().encode(JSON.stringify(s))))].map(l=>l.toString(16).padStart(2,"0")).join(""),_={value:s,pin:{resource:R,version_kind:"git-blob",version:I,snapshot:"2".repeat(40)}};return await A({...u,artifacts:[...u.artifacts.filter(l=>l.pin.resource!==R),_]}),{..._.pin,reviewer:s.reviewer,...a&&s.kind==="review-response"?{dispatch:u.workflow?.dispatch??{state:"failed",message:"Missing installed-source Actions write route. Response is saved."}}:{}}}}}}}export{U as R,$ as a,T as b,G as c,M as d,Y as e,J as f,O as g,h,Q as i,D as j,V as m,b as r,K as s,B as w};
