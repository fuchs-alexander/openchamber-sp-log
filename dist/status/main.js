(()=>{var u="openchamber.sdk",T=1;var Qe=`
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [data-oc-scrolling] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [data-oc-scrolling] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [data-oc-scrolling]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [data-oc-scrolling] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function Qt(e){let r=e.documentElement;if(r.hasAttribute("data-oc-scrollbar-activity"))return;r.setAttribute("data-oc-scrollbar-activity","");let s=new WeakMap;e.addEventListener("scroll",(E)=>{let p=E.target===e?r:E.target;if(!(p instanceof Element))return;if(!p.hasAttribute("data-oc-scrolling"))p.setAttribute("data-oc-scrolling","");let S=s.get(p);if(S!==void 0)clearTimeout(S);s.set(p,setTimeout(()=>{s.delete(p),p.removeAttribute("data-oc-scrolling")},1000))},{capture:!0,passive:!0})}var Jo=`(${Qt.toString()})(document);`;var Ze=128,qe=65536;var xe=128;var Ce=65536;var et=8000,tt=192000,ot=120000;var Zt=(e)=>{let r=[],s=0,E=0;return{push:(p)=>{r.push(p),E+=p.length;while(E-s>e&&r.length>1){let S=r.shift();E-=S?.length??0,s=0}},pull:(p)=>{let S=0;while(S<p.length&&r.length>0){let U=r[0],C=Math.min(p.length-S,U.length-s);if(p.set(U.subarray(s,s+C),S),S+=C,s+=C,s>=U.length)r.shift(),E-=U.length,s=0}p.fill(0,S)},clear:()=>{r.length=0,s=0,E=0},get size(){return E-s}}};var oo=/^[a-z][a-z0-9-]{0,39}$/;var qt=(e)=>Object(e)===e&&!Array.isArray(e),rt=(e,r)=>Object.keys(e).every((s)=>r.includes(s)),eo=(e)=>String(e)===e&&e.length>=1&&e.length<=60,to=(e)=>String(e)===e&&e.length>=1&&e.length<=80,ro=(e)=>{if(!Array.isArray(e)||e.length>4)return!1;let r=new Set;for(let s of e){if(!qt(s)||!oo.test(s.id)||!eo(s.label))return!1;if(s.disabled!==void 0&&s.disabled!==!0&&s.disabled!==!1)return!1;if(r.has(s.id))return!1;if(r.add(s.id),s.kind==="button"){if(!rt(s,["kind","id","label","disabled"]))return!1;continue}if(s.kind!=="select"||!rt(s,["kind","id","label","value","options","disabled"]))return!1;if(!to(s.value)||!Array.isArray(s.options)||s.options.length<1||s.options.length>16)return!1;let E=new Set;for(let p of s.options){if(!qt(p)||!rt(p,["value","label"])||!to(p.value)||!eo(p.label)||E.has(p.value))return!1;E.add(p.value)}if(!E.has(s.value))return!1}return!0};var no=["{id}","{segment}","{segments+}"];var Mr=new Set(no);var so=["turn-finished","turn-failed","permission-asked","question-asked","turn-started","session-created","session-archived","session-deleted"];var yr=new Set(so);var Ue=20000000,ke=256;var nt=(e)=>("bytes"in e)?e.bytes.byteLength:e.content.length,io=(e,r)=>{if(e.path!==r.path||e.readOnly!==r.readOnly)return!1;if(e.encoding==="text"||r.encoding==="text")return e.encoding==="text"&&r.encoding==="text"&&e.content===r.content;if(e.bytes.byteLength!==r.bytes.byteLength)return!1;for(let s=0;s<e.bytes.byteLength;s+=1)if(e.bytes[s]!==r.bytes[s])return!1;return!0};var ao=/^[A-Za-z0-9_-]{1,80}$/;var co=["left","right","top","bottom"];var lo=(e,r=0,s={remaining:16000})=>{if(--s.remaining<0||r>=32)return!1;if(e===null)return!0;let E=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let p of E)if(!lo(p,r+1,s))return!1;return!0},st=(e)=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every((r)=>/^(0|[1-9]\d*)$/.test(r)&&Number(r)<e.length)&&e.every(st);if(Object(e)===e){let r=Object.getPrototypeOf(e);return(r===null||r===Object.prototype)&&Object.values(e).every(st)}return String(e)===e||Number.isFinite(e)},it=(e)=>{try{if(String(e.id)!==e.id||!ao.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!co.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!lo(e.data)||!st(e.data))return!1;return JSON.stringify(e.data).length<=16000}catch{return!1}};var ct=2000;var po=["file","directory","other","missing"],dt=(e)=>Boolean(e&&"sessionId"in e),lt=(e)=>Boolean(e&&"sent"in e&&!("sessionId"in e));var Eo=/^[0-9a-f]{7,64}$/i,_t=(e)=>Eo.test(e),be=500,Me=32000,uo=16000,To=128,So=200,fo=2000,Ao=16000,Oo=80,Ro=200,ho=16000;var mo=2000;var pt=20000,Ne=1024,ye=2000000;var Le=64000,ve=8000,Et=4000;var ut=960000;var Io=999,go=1e4,pe=500,xo=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],Co=["stopped","starting","ready","failed"],Zo=new Set(xo),Uo=(e)=>Zo.has(e),ko=(e)=>e&&Uo(e)?e:"HOST_REJECTED",q=(e)=>{if(e===void 0)return!1;if(e===null||e===!0||e===!1)return!0;if(String(e)===e)return!0;if(Number(e)===e)return Number.isFinite(e);if(Array.isArray(e))return e.every(q);if(Object(e)===e)return Object.values(e).every(q);return!1},bo=(e)=>q(e)&&JSON.stringify(e).length<=ho,_o=(e)=>e?.trim().slice(0,Ro)??"",ee=(e)=>{let r=e.id.trim().slice(0,To),s=e.title.trim().slice(0,So),E=e.url.trim().slice(0,fo),p=e.text?.trim().slice(0,Ao),S=e.author?.trim().slice(0,Oo),U=e.kind==="pull"?"pull":"issue",C={providerId:e.providerId.trim(),id:r,title:s||r,url:E,kind:U};if(p)C.text=p;if(S)C.author=S;if(U==="pull"){let H=_o(e.branches?.head),G=_o(e.branches?.base);if(H&&G)C.branches={head:H,base:G}}if(bo(e.data))C.data=e.data;return C},Tt=(e)=>{let r=ee(e);if(e.projectId)r.projectId=e.projectId;if(e.navigation)r.navigation=e.navigation;if(e.worktree)r.worktree=e.worktree;return r},St=(e)=>{let r={text:e.text.trim().slice(0,uo)};if(e.send)r.send=!0;return r},ft=(e)=>{if(e===null||!Number.isFinite(e))return null;return Math.min(Io,Math.max(0,Math.round(e)))},At=(e)=>{if(!Number.isFinite(e))return 0;return Math.min(go,Math.max(0,Math.ceil(e)))};var te=(e)=>e.length>0&&e.length<=Ne&&!e.includes("\x00")&&!e.includes("\\");var Pe=(e)=>{if(!e.startsWith("/")||e.includes("\x00")||e.includes("\\")||e.includes("://"))return!1;if(e.length>mo)return!1;return!e.split("/").some((s)=>s==="."||s==="..")},qo=new Set(Co),Ot=(e)=>Boolean(e&&"status"in e&&qo.has(String(e.status))&&!("body"in e)),we=(e)=>Boolean(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),Rt=(e)=>Boolean(e&&"content"in e&&String(e.content)===e.content),ht=(e)=>Boolean(e&&"written"in e&&e.written===!0),mt=(e)=>Boolean(e&&"entries"in e&&Array.isArray(e.entries)),er=new Set(po),It=(e)=>Boolean(e&&"kind"in e&&"size"in e&&er.has(String(e.kind))&&Number.isFinite(e.size)),gt=(e)=>Boolean(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),tr=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","service-event","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late","microphone-audio","microphone-ended"]),or=(e)=>Object(e)===e?e:null,at=(e)=>String(e)===e&&e.length>0,rr=(e)=>{if(!at(e.id))return null;if(e.ok===!0){let r={channel:u,v:T,type:"result",id:e.id,ok:!0};if(Object(e.payload)===e.payload)r.payload=e.payload;return r}if(e.ok===!1&&at(e.error))return{channel:u,v:T,type:"result",id:e.id,ok:!1,error:e.error,code:ko(at(e.code)?e.code:void 0)};return null},xt=(e)=>{let r=or(e);if(!r||r.channel!==u||r.v!==T)return null;if(r.type==="result")return rr(r);if(!tr.has(String(r.type))||Object(r.payload)!==r.payload)return null;return r};var Mo=(e)=>("key"in e)&&("metaKey"in e)&&("ctrlKey"in e),nr=(e)=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s";class c extends Error{code;constructor(e,r){super(r);this.name="HostRequestError",this.code=e}}var No=()=>Promise.reject(new c("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),Ge=()=>Promise.reject(new c("BAD_PATH",`File path must be 1 to ${Ne} characters without NUL or backslash.`)),De=(e)=>{if(e===void 0)return;if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new c("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0},_=(e)=>(e.value+=1,`oc-${e.value}`),Ct=(e={})=>{let r=e.target??("window"in globalThis?window:null);if(!r)throw new c("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let s=e.acceptSource??((t)=>t===r.parent),E=e.requestTimeoutMs??pt,p=new Set,S=new Set,U=new Set,C=new Set,H=new Set,G=new Set,se=new Set,Se=new Set,fe=new Set,Ae=new Set,Oe=new Set,z=new Set,Ke=[],ie=null,ae=null,Re=new Set,he=new Set,ce=null,de=null,We=!1,Y=new Map,J=new Map,Q=new Map,D=!1,l={value:0},d=null,V=null,le=!1,_e=!1,Xt=null,v=null,Ht=(t)=>{if(!t)return null;return{sessionId:t.id,phase:t.busy?"started":"completed"}},M=(t)=>{r.parent.postMessage(t,"*")},$t=()=>{if(D||r.parent===r||z.size===0||d?.features?.lateGenerateResults!==!0)return;M({channel:u,v:T,type:"generate-late-listen"})},O=(t,o)=>{for(let a of t)try{a(o)}catch(i){console.error(i)}},Vt=(t)=>{if(!(t instanceof MessageEvent))return;if(!s(t.source))return;let o=xt(t.data);if(!o)return;if(o.type==="workspace"){let i=J.get(o.payload.subscriptionId);if(i)O([i],o.payload.snapshot);return}if(o.type==="shells"){let i=Q.get(o.payload.subscriptionId);if(i)O([i],o.payload.snapshot);return}if(o.type==="microphone-audio"){v?.queue.push(o.payload.samples);return}if(o.type==="microphone-ended"){let i=v;if(!i)return;v=null,i.release(),O(i.endedListeners,o.payload.reason);return}if(o.type==="ready"){if(d=o.payload,V=Ht(o.payload.session),O(p,o.payload),O(S,o.payload.directory),O(U,o.payload.session),V)O(C,V);if(O(H,o.payload.connection),O(G,o.payload.settings),O(se,o.payload.item),o.payload.block)O(Se,o.payload.block);$t();return}if(o.type==="service-event"){O(fe,o.payload);return}if(o.type==="generate-late"){if(z.size===0)Ke.push(o.payload);else O(z,o.payload);return}if(o.type==="directory"){if(d)d={...d,directory:o.payload.directory};O(S,o.payload.directory);return}if(o.type==="session"){if(d)d={...d,session:o.payload.session};if(!o.payload.session)V=null;else if(V?.sessionId!==o.payload.session.id)V=Ht(o.payload.session);O(U,o.payload.session);return}if(o.type==="session-lifecycle"){V=o.payload,O(C,o.payload);return}if(o.type==="connection"){if(d)d={...d,connection:o.payload.connection};O(H,o.payload.connection);return}if(o.type==="settings"){if(d)d={...d,settings:o.payload.settings};O(G,o.payload.settings);return}if(o.type==="item"){if(d)d={...d,item:o.payload.item};O(se,o.payload.item);return}if(o.type==="status-control-event"){O(Ae,o.payload);return}if(o.type==="popover-closed"){O(Oe,o.payload);return}if(o.type==="action"){let i=(A)=>{if(!D)M({channel:u,v:T,type:"action-result",id:o.id,payload:A})},f=ae;if(!f){i({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>f(o.payload)).then(()=>i({ok:!0}),(A)=>{let R=(A instanceof Error?A.message:String(A)).trim();i({ok:!1,error:(R||"Action failed.").slice(0,pe)})});return}if(o.type==="file-open"){let i=o.payload;if(de&&io(de,i))return;de=i,O(Re,o.payload);return}if(o.type==="file-saved"){O(he,o.payload.version);return}if(o.type==="file-snapshot"){let i=(R)=>{if(!D)M({channel:u,v:T,type:"file-snapshot-result",id:o.id,payload:R})},f=(R)=>i({error:(R.trim()||"Could not read the edited file.").slice(0,pe)}),A=ce;if(!A){f("This extension does not edit files.");return}Promise.resolve().then(()=>A(o.payload.purpose)).then((R)=>{if(nt(R)>Ue){f(`The file is over ${Ue} ${"bytes"in R?"bytes":"characters"}.`);return}if(R.version.length>ke){f(`The snapshot version is over ${ke} characters.`);return}i({snapshot:"bytes"in R?{bytes:R.bytes,version:R.version}:{content:R.content,version:R.version}})},(R)=>f(R instanceof Error?R.message:String(R)));return}if(o.type==="resolve"){let i=(A)=>{M({channel:u,v:T,type:"resolve-result",id:o.id,payload:A})},f=ie;if(!f){i({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>f(o.payload)).then((A)=>i({item:A?ee(A):null}),(A)=>{let R=(A instanceof Error?A.message:String(A)).trim();i({error:(R||"Command failed.").slice(0,pe)})});return}let a=Y.get(o.id);if(!a)return;if(clearTimeout(a.timer),Y.delete(o.id),o.ok){a.resolve(o.payload);return}a.reject(new c(o.code,o.error))};r.addEventListener("message",Vt),M({channel:u,v:T,type:"hello"});let k=(t,o=E)=>{if(D||r.parent===r)return Promise.reject(new c("HOST_UNAVAILABLE","No host frame. This page is not in an iframe."));return new Promise((a,i)=>{let f=setTimeout(()=>{Y.delete(t.id),i(new c("HOST_TIMEOUT","Host did not answer in time."))},o);Y.set(t.id,{resolve:a,reject:i,timer:f}),M(t)})},x=(t)=>k(t).then(()=>{return}),m={channel:u,v:T},je=(t)=>{if(!D&&r.parent!==r)M(t)},Ft=()=>je({...m,type:"file-save"}),ze=()=>{if(!D&&r.parent!==r)M({...m,type:"microphone-close",id:_(l)})},zo=async()=>{if(v)throw new c("HOST_REJECTED","The microphone is already open in this frame.");if(d?.features?.microphone!==!0)throw new c("UNSUPPORTED","This OpenChamber cannot share the microphone with extensions.");let t=globalThis.AudioContext;if(typeof t!=="function")throw new c("UNSUPPORTED","This frame has no Web Audio.");let o=new t;if(o.sampleRate<et||o.sampleRate>tt)throw o.close().catch(()=>{return}),new c("UNSUPPORTED",`Audio at ${o.sampleRate} Hz is not supported.`);let a=o.state==="suspended"?o.resume().catch(()=>{return}):void 0,i=Zt(Math.round(o.sampleRate/4)),f=o.createScriptProcessor(1024,1,1);f.onaudioprocess=(w)=>i.pull(w.outputBuffer.getChannelData(0));let A=o.createMediaStreamDestination();f.connect(A);let R=new Set,Z={queue:i,endedListeners:R,release:()=>{f.onaudioprocess=null,f.disconnect(),i.clear();for(let w of A.stream.getTracks())w.stop();o.close().catch(()=>{return})}};v=Z;try{let w=await k({...m,type:"microphone-open",id:_(l),payload:{sampleRate:o.sampleRate}},ot);if(!w||!("opened"in w)||w.opened!==!0)throw new c("HOST_REJECTED","Host did not open the microphone.");if(await a,v!==Z)throw new c("DISCONNECTED","The microphone closed while it was opening.")}catch(w){if(v===Z)v=null;throw Z.release(),ze(),w}return{stream:A.stream,close:()=>{if(v!==Z)return;v=null,Z.release(),ze()},onEnded:(w)=>(R.add(w),()=>{R.delete(w)})}},Bt=(t)=>{if(!Mo(t)||!nr(t))return;t.preventDefault(),Ft()},Kt=(t)=>{if(!Mo(t)||t.key!=="Escape"||d?.surface!=="popover"||!d.popover)return;t.preventDefault(),Yt(d.popover.id,"escape").catch(()=>{return})},me=()=>{let t=d?.surface==="popover"?d.popover:void 0;if(!t)return;let o=le||_e;if(Xt===o)return;Xt=o,Jt(t.id,o).catch(()=>{return})},Ie=()=>{if(d?.surface!=="popover"||le)return;le=!0,me()},Wt=(t)=>{if(d?.surface!=="popover"||t.relatedTarget!==null||!le)return;le=!1,me()},jt=()=>{if(d?.surface!=="popover"||_e)return;_e=!0,me()},zt=()=>{if(d?.surface!=="popover"||!_e)return;_e=!1,me()},X=(t,o=1024)=>{if(!t.trim()||t.length>o)throw new c("HOST_REJECTED",`Identity must contain 1 to ${o} characters.`)},Ye=async(t)=>{if(t.kind!=="projects")X(t.projectId);let o=await k({...m,type:"workspace-read",id:_(l),payload:t});if(!o||!("kind"in o)||!("state"in o)||o.kind!==t.kind)throw new c("HOST_REJECTED","Host did not return workspace data.");return o},Je=async(t,o)=>{if(t.kind!=="projects")X(t.projectId);let a=_(l);J.set(a,o);try{await x({...m,type:"workspace-subscribe",id:_(l),payload:{subscriptionId:a,query:t}})}catch(i){if(J.delete(a),!D)M({...m,type:"workspace-unsubscribe",id:_(l),payload:{subscriptionId:a}});throw i}return()=>{if(!J.delete(a)||D)return;M({...m,type:"workspace-unsubscribe",id:_(l),payload:{subscriptionId:a}})}},Yo=async(t,o)=>{if(t.kind==="session")X(t.sessionId);if(t.kind==="project")X(t.projectId);let a=_(l);Q.set(a,o);try{await x({...m,type:"shells-subscribe",id:_(l),payload:{subscriptionId:a,scope:t}})}catch(i){if(Q.delete(a),!D)M({...m,type:"shells-unsubscribe",id:_(l),payload:{subscriptionId:a}});throw i}return()=>{if(!Q.delete(a)||D)return;M({...m,type:"shells-unsubscribe",id:_(l),payload:{subscriptionId:a}})}},ge=async(t)=>{if("key"in t&&(t.key.length===0||t.key.length>Ze))throw new c("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!q(t.value))throw new c("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>qe)throw new c("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&d?.features?.deviceStorage!==!0)throw new c("UNSUPPORTED","This host does not support device storage.");let o=await k({...m,type:"storage",id:_(l),payload:t});if(!o||!("storage"in o)||o.op!==t.op)throw new c("HOST_REJECTED","Host did not return storage data.");return o},Yt=(t,o)=>d?.features?.popovers!==!0&&!(d?.surface==="popover"&&d.popover?.id===t)?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):x({...m,type:"popover-close",id:_(l),payload:o?{id:t,reason:o}:{id:t}}),Jt=(t,o)=>d?.features?.popovers!==!0&&!(d?.surface==="popover"&&d.popover?.id===t)?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):x({...m,type:"popover-anchor",id:_(l),payload:{id:t,active:o}});return r.addEventListener("keydown",Kt,!0),r.addEventListener("pointerover",Ie),r.addEventListener("pointermove",Ie),r.addEventListener("pointerout",Wt),r.addEventListener("focus",jt),r.addEventListener("blur",zt),{onAction:(t)=>(ae=t,()=>{if(ae===t)ae=null}),listProjects:async()=>{let t=await Ye({kind:"projects"});if(t.kind!=="projects")throw new c("HOST_REJECTED","Expected projects.");return t},listWorktrees:async(t)=>{let o=await Ye({kind:"worktrees",projectId:t});if(o.kind!=="worktrees")throw new c("HOST_REJECTED","Expected worktrees.");return o},listSessions:async(t)=>{let o=await Ye({kind:"sessions",projectId:t});if(o.kind!=="sessions")throw new c("HOST_REJECTED","Expected sessions.");return o},onProjects:(t)=>Je({kind:"projects"},(o)=>{if(o.kind==="projects")t(o)}),onWorktrees:(t,o)=>Je({kind:"worktrees",projectId:t},(a)=>{if(a.kind==="worktrees")o(a)}),onSessions:(t,o)=>Je({kind:"sessions",projectId:t},(a)=>{if(a.kind==="sessions")o(a)}),onRunningShells:(t,o)=>Yo(t,o),readShellOutput:async(t,o)=>{X(t,xe);let a=o?.cursor;if(a!==void 0&&(!Number.isInteger(a)||a<0))throw new c("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let i=o?.tailBytes;if(i!==void 0&&(!Number.isInteger(i)||i<1||i>Ce))throw new c("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${Ce}.`);let A=await k({...m,type:"shell-output",id:_(l),payload:{shellId:t,cursor:a,tailBytes:i}});if(!A||typeof A.output!=="string"||!Number.isFinite(A.cursor))throw new c("HOST_REJECTED","Host did not return shell output.");return A},stopShell:async(t)=>{if(X(t,xe),(await k({...m,type:"shell-stop",id:_(l),payload:{shellId:t}}))?.stopped!==!0)throw new c("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async(t)=>{X(t),await x({...m,type:"open-session",id:_(l),payload:{sessionId:t}})},storage:{get:async(t,o)=>{let a=De(o),i={op:"get",key:t};if(a)i.scope=a;let f=await ge(i);return f.op==="get"&&f.found?f.value:void 0},set:async(t,o,a)=>{let i=De(a),f={op:"set",key:t,value:o};if(i)f.scope=i;await ge(f)},delete:async(t,o)=>{let a=De(o),i={op:"delete",key:t};if(a)i.scope=a;await ge(i)},keys:async(t)=>{let o=De(t),a={op:"keys"};if(o)a.scope=o;let i=await ge(a);if(i.op!=="keys")throw new c("HOST_REJECTED","Expected storage keys.");return i.keys}},onReady:(t)=>{if(p.add(t),d)t(d);return()=>{p.delete(t)}},onDirectory:(t)=>{if(S.add(t),d)t(d.directory);return()=>{S.delete(t)}},onSession:(t)=>{if(U.add(t),d)t(d.session);return()=>{U.delete(t)}},onSessionLifecycle:(t)=>{if(C.add(t),V)t(V);return()=>{C.delete(t)}},onConnection:(t)=>{if(H.add(t),d)t(d.connection);return()=>{H.delete(t)}},onSettings:(t)=>{if(G.add(t),d)t(d.settings);return()=>{G.delete(t)}},onItem:(t)=>{if(se.add(t),d)t(d.item);return()=>{se.delete(t)}},onBlock:(t)=>{if(Se.add(t),d?.block)t(d.block);return()=>{Se.delete(t)}},onServiceEvent:(t)=>(fe.add(t),()=>{fe.delete(t)}),onStatusControl:(t)=>(Ae.add(t),()=>{Ae.delete(t)}),onPopoverClosed:(t)=>(Oe.add(t),()=>{Oe.delete(t)}),setStatusControls:(t)=>{if(d?.features?.statusControls!==!0)return Promise.reject(new c("UNSUPPORTED","This host does not support status controls."));if(!ro(t))return Promise.reject(new c("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options."));return x({...m,type:"status-controls",id:_(l),payload:{controls:t}})},openPopover:(t)=>{if(d?.features?.popovers!==!0)return Promise.reject(new c("UNSUPPORTED","This host does not support popovers."));if(!it(t))return Promise.reject(new c("HOST_REJECTED","Popover requests need bounded geometry and JSON data."));return x({...m,type:"popover-open",id:_(l),payload:t})},closePopover:Yt,setPopoverAnchorActive:Jt,onResolve:(t)=>(ie=t,()=>{if(ie===t)ie=null}),toast:(t)=>{let o=t.message.trim();if(!o||o.length>be)return Promise.reject(new c("HOST_REJECTED",`Toast message must contain 1 to ${be} characters.`));if(t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>Me))return Promise.reject(new c("HOST_REJECTED",`Toast copy text must contain 1 to ${Me} characters.`));return x({channel:u,v:T,type:"toast",id:_(l),payload:{...t,message:o}})},openUrl:(t)=>x({channel:u,v:T,type:"open-url",id:_(l),payload:{url:t}}),openCommit:(t)=>_t(t)?x({channel:u,v:T,type:"open-commit",id:_(l),payload:{sha:t}}):Promise.reject(new c("HOST_REJECTED","Commit id must be 7 to 64 hex characters.")),answerBlock:(t)=>x({channel:u,v:T,type:"block-answer",id:_(l),payload:{text:t.trim().slice(0,ct)}}),openSurface:(t)=>x({channel:u,v:T,type:"open-surface",id:_(l),payload:{surfaceId:t}}),writeClipboard:(t)=>x({channel:u,v:T,type:"clipboard-write",id:_(l),payload:{text:t}}),compose:(t)=>x({channel:u,v:T,type:"compose",id:_(l),payload:t}),attach:(t)=>x({channel:u,v:T,type:"attach",id:_(l),payload:ee(t)}),startSession:async(t)=>{if(t.projectId!==void 0)X(t.projectId);let o=t.worktree;if(o&&o!==!0)if(o.kind==="existing")X(o.directory);else{if(o.name!==void 0)X(o.name,200);if(o.baseBranch!==void 0)X(o.baseBranch,200)}let a=await k({channel:u,v:T,type:"start-session",id:_(l),payload:Tt(t)},e.requestTimeoutMs??180000);if(!dt(a))throw new c("HOST_REJECTED","Host did not return a session.");return a},prompt:(t)=>k({channel:u,v:T,type:"prompt",id:_(l),payload:St(t)}).then((o)=>{if(!lt(o))throw new c("HOST_REJECTED","Host did not return a prompt result.");return o}),sessionLink:(t)=>x({channel:u,v:T,type:"session-link",id:_(l),payload:ee(t)}),close:()=>x({channel:u,v:T,type:"close",id:_(l)}),oauthStart:()=>x({channel:u,v:T,type:"oauth-start",id:_(l)}),oauthDisconnect:()=>x({channel:u,v:T,type:"oauth-disconnect",id:_(l)}),request:(t)=>(Pe(t.path)?k({channel:u,v:T,type:"request",id:_(l),payload:t}):No()).then((o)=>{if(!we(o))throw new c("HOST_REJECTED","Host request result was empty.");return o}),serviceRequest:(t)=>(Pe(t.path)?k({channel:u,v:T,type:"service-request",id:_(l),payload:t}):No()).then((o)=>{if(!we(o))throw new c("HOST_REJECTED","Host service request result was empty.");return o}),serviceStatus:()=>k({channel:u,v:T,type:"service-status",id:_(l)}).then((t)=>{if(!Ot(t))throw new c("HOST_REJECTED","Host did not return service status.");return t}),readFile:(t)=>(te(t)?k({channel:u,v:T,type:"file-read",id:_(l),payload:{path:t}}):Ge()).then((o)=>{if(!Rt(o))throw new c("HOST_REJECTED","Host did not return file content.");return o}),writeFile:(t,o)=>{if(!te(t))return Ge();if(o.length>ye)return Promise.reject(new c("FILE_TOO_LARGE",`Content is over ${ye} characters.`));return k({channel:u,v:T,type:"file-write",id:_(l),payload:{path:t,content:o}}).then((a)=>{if(!ht(a))throw new c("HOST_REJECTED","Host did not confirm the write.");return a})},listDir:(t)=>(te(t)?k({channel:u,v:T,type:"file-list",id:_(l),payload:{path:t}}):Ge()).then((o)=>{if(!mt(o))throw new c("HOST_REJECTED","Host did not return directory entries.");return o}),stat:(t)=>(te(t)?k({channel:u,v:T,type:"file-stat",id:_(l),payload:{path:t}}):Ge()).then((o)=>{if(!It(o))throw new c("HOST_REJECTED","Host did not return file status.");return o}),generate:(t)=>{let o=t.prompt.trim(),a=t.system?.trim();if(o.length===0||o.length>Le)return Promise.reject(new c("HOST_REJECTED",`Prompt must be 1 to ${Le} characters.`));if(a!==void 0&&(a.length===0||a.length>ve))return Promise.reject(new c("HOST_REJECTED",`System prompt must be 1 to ${ve} characters.`));let i=t.maxOutputTokens===void 0?void 0:Math.min(Et,Math.max(1,Math.floor(t.maxOutputTokens)));if(i!==void 0&&!Number.isFinite(i))return Promise.reject(new c("HOST_REJECTED","maxOutputTokens must be a number."));let f={prompt:o};if(a!==void 0)f.system=a;if(i!==void 0)f.maxOutputTokens=i;return k({channel:u,v:T,type:"generate",id:_(l),payload:f},e.requestTimeoutMs??ut).then((A)=>{if(!gt(A))throw new c("HOST_REJECTED","Host did not return generated text.");return A})},onLateGenerateResult:(t)=>{z.add(t);for(let o of Ke.splice(0))O([t],o);return $t(),()=>{z.delete(t)}},openMicrophone:zo,setBadge:(t)=>x({channel:u,v:T,type:"badge",id:_(l),payload:{count:ft(t)}}),setHeight:(t)=>x({channel:u,v:T,type:"resize",id:_(l),payload:{height:At(t)}}),onFileOpen:(t)=>{if(Re.add(t),!We)We=!0,r.addEventListener("keydown",Bt,!0);if(de)t(de);return()=>{Re.delete(t)}},onFileSnapshot:(t)=>(ce=t,()=>{if(ce===t)ce=null}),onFileSaved:(t)=>(he.add(t),()=>{he.delete(t)}),reportFileChange:(t)=>je({...m,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:Ft,reportFileUnsupported:()=>je({...m,type:"file-unsupported"}),dispose:()=>{for(let t of J.keys())M({...m,type:"workspace-unsubscribe",id:_(l),payload:{subscriptionId:t}});J.clear();for(let t of Q.keys())M({...m,type:"shells-unsubscribe",id:_(l),payload:{subscriptionId:t}});if(Q.clear(),v)ze(),v.release(),v=null;if(D=!0,ie=null,ae=null,ce=null,Re.clear(),he.clear(),We)r.removeEventListener("keydown",Bt,!0);r.removeEventListener("message",Vt),r.removeEventListener("keydown",Kt,!0),r.removeEventListener("pointerover",Ie),r.removeEventListener("pointermove",Ie),r.removeEventListener("pointerout",Wt),r.removeEventListener("focus",jt),r.removeEventListener("blur",zt);for(let t of Y.values())clearTimeout(t.timer),t.reject(new c("HOST_UNAVAILABLE","Host client was disposed."));Y.clear(),p.clear(),S.clear(),U.clear(),C.clear(),H.clear(),G.clear(),se.clear(),Se.clear(),fe.clear(),Ae.clear(),Oe.clear(),z.clear(),Ke.length=0}}};var yo=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var Yr=new Set(yo);var Lo=["none","agent","user"];var Qr=new Set(Lo);var sr=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],ir=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],vo=(e,r)=>{r.style.colorScheme=e.mode;for(let[s,E]of sr)r.style.setProperty(s,e.tokens[E]);for(let[s,E,p]of ir){let S=e.tokens[p]??"";r.style.setProperty(s,S),r.style.setProperty(E,S)}r.style.setProperty("font-family",e.tokens.font),r.style.setProperty("font-size",e.tokens.fontSize??"0.875rem"),r.style.setProperty("line-height","1.45"),r.style.setProperty("color",e.tokens.foreground)},Ut=(e,r)=>{if(vo(e.theme,r),r.dataset)r.dataset.ocSurface=e.surface,r.dataset.ocTheme=e.theme.mode};var ar={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},h=(e,r)=>`var(--${e}, var(--oc-${ar[e]}, ${r}))`,B=h("surface-background","transparent"),He=h("surface-elevated","transparent"),oe=h("surface-elevated-foreground","inherit"),P=h("surface-foreground","inherit"),I=h("surface-muted-foreground","gray"),cr=h("surface-muted","transparent"),W=h("interactive-border","currentColor"),N=h("interactive-hover","transparent"),j=h("interactive-active","transparent"),kt=h("interactive-selection","transparent"),bt=h("interactive-selection-foreground","inherit"),F=h("primary","currentColor"),Mt=h("primary-text","inherit"),Nt=h("error-text","inherit"),dr=h("font-sans","inherit"),yt=h("font-mono","monospace"),Do=h("radius","9px"),Lt=`calc(${Do} - 2px)`,Po=`calc(${Do} - 4px)`,g=(e,r,s="transparent")=>`color-mix(in srgb, ${e} ${r}%, ${s})`,wo=`background-image: linear-gradient(${N}, ${N});`,vt=(e,r="0.5px")=>`box-shadow: inset 0 0 0 ${r} ${e}, var(--oc-sdk-field-lift);`,Pt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",Go="box-shadow: var(--oc-sdk-lit);",wt=`inset 0 0.5px 0 0 ${g(P,8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`,lr=`
:root {
  --oc-sdk-edge: ${g(P,16)};
  --oc-sdk-field-bg: ${He};
  --oc-sdk-raised-bg: ${B};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${g(P,14)};
  --oc-sdk-field-bg: ${g(B,50,He)};
  --oc-sdk-raised-bg: ${He};
  --oc-sdk-field-lift: ${wt};
  --oc-sdk-raised-lift: ${wt};
  --oc-sdk-lit: ${wt};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`,Xe=(e)=>{let r=h(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${r}; --oc-sdk-tone-text: ${h(`${e}-text`,"inherit")}; }`},n=(e)=>`calc(${e}rem / 14)`,_r=`
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${n(8)}; height: ${n(32)}; padding: 0 ${n(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${n(6)}; height: ${n(28)}; padding: 0 ${n(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${n(4)}; height: ${n(24)}; padding: 0 ${n(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${n(14)}; height: ${n(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${n(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${n(32)}; padding: 0 ${n(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${n(8)} ${n(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${n(34)}; padding-right: ${n(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${n(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${n(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${n(24)}; height: ${n(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${n(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${n(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${n(28)}; padding: 0 ${n(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${n(2)}; min-width: ${n(160)}; max-width: calc(100vw - ${n(16)}); max-height: min(${n(320)}, calc(100vh - ${n(16)})); overflow: auto; padding: ${n(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${n(2)} ${n(2)} ${n(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${n(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${n(8)}; width: 100%; padding: ${n(6)} ${n(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${n(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${n(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${n(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${n(14)}; height: ${n(14)}; margin-top: ${n(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${n(36)}; height: ${n(20)}; --oc-sdk-thumb-travel: ${n(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${n(2)}; left: ${n(2)}; width: ${n(16)}; height: ${n(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${n(2)}; padding: ${n(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${n(6)}; height: ${n(28)}; padding: 0 ${n(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${n(1)} ${n(6)}; font-size: ${n(11)}; font-weight: 500; line-height: ${n(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${n(8)}; width: 100%; padding: ${n(6)} ${n(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${n(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${n(16)} ${n(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${n(4)}; padding: ${n(40)} ${n(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${n(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${n(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${n(16)}; height: ${n(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${n(12)}; height: ${n(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${n(12)}; padding: ${n(8)} ${n(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${n(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${n(8)}; width: 100%; margin: ${n(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${n(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${n(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${n(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${n(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${n(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${n(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${n(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${n(36)}; height: ${n(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${n(44)}; }
  .oc-sdk-check { min-height: ${n(36)}; padding: ${n(8)} 0; }
}
`,Xo=`${lr}
.oc-sdk { color: ${P}; font-family: ${dr}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${wo} }
.oc-sdk-mono { font-family: ${yt}; }
.oc-sdk-muted { color: ${I}; }
${Xe("success")}${Xe("warning")}${Xe("error")}${Xe("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${F}; --oc-sdk-tone-text: ${Mt}; }

.oc-sdk-btn { border-radius: ${Lt}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${Po}; }
.oc-sdk-btn[data-variant="default"] { color: ${Mt}; background: ${g(F,10,B)}; border-color: ${g(F,12)}; ${Go} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${g(F,16,B)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${g(F,22,B)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${cr}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${N}, ${N}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${j}, ${j}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${oe}; ${Pt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${N}, ${N}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${j}, ${j}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${N}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${j}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${h("status-error","red")}; color: ${Nt}; background: ${g("var(--oc-sdk-tone)",7,B)}; border-color: ${g("var(--oc-sdk-tone)",12)}; ${Go} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${g("var(--oc-sdk-tone)",9,B)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${g("var(--oc-sdk-tone)",11,B)}; box-shadow: none; }

.oc-sdk-field-note { color: ${I}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${Nt}; }
.oc-sdk-input { border-radius: ${Lt}; background: var(--oc-sdk-field-bg); color: ${oe}; ${vt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${I}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${N}, ${N}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${vt(g(P,26),"1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${vt(h("status-error","red"),"1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${yt}; }

.oc-sdk-search-icon { color: ${I}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${F}; }
.oc-sdk-search-clear { border-radius: ${Po}; color: ${I}; }
.oc-sdk-search-clear:hover { background: ${N}; color: ${P}; }

.oc-sdk-trigger { border-radius: ${Lt}; background: var(--oc-sdk-raised-bg); color: ${oe}; ${Pt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${N}, ${N}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${j}, ${j}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${I}; }
.oc-sdk-trigger-chevron { color: ${I}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${oe}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${He}; background-clip: padding-box; color: ${oe}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${N}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${kt}; color: ${bt}; }
.oc-sdk-option-check { color: ${P}; }
.oc-sdk-option[data-destructive="true"] { color: ${Nt}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${g(h("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${I}; }
.oc-sdk-popup-empty { color: ${I}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${W}; border-radius: 4px; color: ${P}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${g(P,60,W)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${W}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${B}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${F}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${wo} }
.oc-sdk-check-desc { color: ${I}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${g(P,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${I}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${P}; }
.oc-sdk-tab[aria-selected="true"] { color: ${bt}; background: ${kt}; border-color: ${W}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${oe}; background: var(--oc-sdk-raised-bg); ${Pt} }
.oc-sdk-tab-count { color: ${I}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${g(P,6)}; color: ${I}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${g("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${N}; }
.oc-sdk-row[aria-selected="true"] { background: ${kt}; color: ${bt}; }
.oc-sdk-row-lead { font-family: ${yt}; color: ${I}; }
.oc-sdk-row-sub { color: ${I}; }
.oc-sdk-row-meta { color: ${I}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${I}; }

.oc-sdk-empty-body { color: ${I}; }

.oc-sdk-spinner { color: ${I}; }
.oc-sdk-spinner-ring { border-color: ${W}; border-top-color: ${F}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${g("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${I}; }

.oc-sdk-separator { color: ${I}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${g(W,40)}; }

.oc-sdk-progress-label { color: ${I}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${g(P,6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${F}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${h("status-success","currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${h("success-text","inherit")}; }

.oc-sdk-text a { color: ${Mt}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${g(W,60)}; }
`,b=`
${Qe}
${_r}
${Xo}`;var ue={scope:"instance"},Sr=(e)=>!!e&&typeof e==="object"&&typeof e.at==="number"&&Number.isFinite(e.at)&&typeof e.hours==="number"&&Number.isFinite(e.hours);function fr(e){if(!e||typeof e!=="object")return null;let{taskId:r,lastMessageId:s,lastCreatedAt:E,lastLogId:p,taskTitle:S,projectTitle:U,logs:C}=e;if(typeof r!=="string")return null;if(s!==null&&typeof s!=="string")return null;let H=typeof E==="number"&&Number.isFinite(E)?E:null;return{taskId:r,lastMessageId:s,lastCreatedAt:H,lastLogId:typeof p==="string"?p:null,taskTitle:typeof S==="string"?S:null,projectTitle:typeof U==="string"?U:null,logs:Array.isArray(C)?C.filter(Sr).map((G)=>({at:G.at,hours:G.hours})):null}}function Ho(e){return{async getProject(r){let s=await e.storage.get(`project:${r}`,ue);return typeof s==="string"?s:null},async setProject(r,s){await e.storage.set(`project:${r}`,s,ue)},async getBinding(r){return fr(await e.storage.get(`session:${r}`,ue))},async setBinding(r,s){let E={taskId:s.taskId,lastMessageId:s.lastMessageId,lastCreatedAt:s.lastCreatedAt,lastLogId:s.lastLogId,taskTitle:s.taskTitle,projectTitle:s.projectTitle,logs:s.logs?s.logs.map((p)=>({at:p.at,hours:p.hours})):null};await e.storage.set(`session:${r}`,E,ue)},async clearBinding(r){await e.storage.delete(`session:${r}`,ue)}}}var $o=(e)=>String(e).padStart(2,"0");function Ar(e){let r=new Date(e);return`${$o(r.getDate())}.${$o(r.getMonth()+1)}.${r.getFullYear()}`}function Vo(e){return`≈ ${String(Math.round(e*100)/100).replace(".",",")} h`}function Fo(e,r){if(!e)return{lines:["Noch nicht geloggt","Loggen: … → Export → Nach Super Productivity loggen"]};let s=[];if(e.taskTitle)s.push(`Geloggt in „${e.taskTitle}“${e.projectTitle?` (${e.projectTitle})`:""}`);else s.push("Gebunden an SP-Aufgabe");let E=e.logs;if(!E)s.push("Logs: unbekannt (vor 0.3.0)");else{let p=E.reduce((U,C)=>U+C.hours,0);s.push(`${E.length} ${E.length===1?"Log":"Logs"} · Summe ${Vo(p)}`);let S=E[E.length-1];if(S)s.push(`Letzter Log: ${Ar(S.at)} · ${Vo(S.hours)}`)}return s.push("Loggen: … → Export → Nach Super Productivity loggen"),{lines:s}}var Te=Ct(),Or=Ho(Te),Wo=document.getElementById("lines"),ne=null,Bo=0;function Ko(e){Wo.replaceChildren(...e.map((r,s)=>{let E=document.createElement("p");if(E.textContent=r,s===e.length-1)E.className="muted";return E})),Te.setHeight(Math.ceil(document.body.scrollHeight)).catch(()=>{})}async function Dt(){let e=++Bo;if(!ne){Ko(["Keine Session geöffnet."]);return}let r=await Or.getBinding(ne).catch(()=>null);if(e!==Bo)return;Ko(Fo(r,new Date).lines)}function jo(e){if(e===ne&&Wo.childElementCount>0)return;ne=e,Dt()}Te.onReady((e)=>{Ut(e,document.documentElement),jo(e.session?.id??null)});Te.onSession((e)=>jo(e?.id??null));Te.onServiceEvent(({topic:e,data:r})=>{if(e!=="logged"||!ne)return;if(r&&typeof r==="object"&&!Array.isArray(r)&&r.sessionId===ne)Dt()});document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")Dt()});})();
