(function(){const r=document.createElement("link").relList;if(r&&r.supports&&r.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))i(e);new MutationObserver(e=>{for(const n of e)if(n.type==="childList")for(const a of n.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&i(a)}).observe(document,{childList:!0,subtree:!0});function s(e){const n={};return e.integrity&&(n.integrity=e.integrity),e.referrerPolicy&&(n.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?n.credentials="include":e.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function i(e){if(e.ep)return;e.ep=!0;const n=s(e);fetch(e.href,n)}})();function c(t=""){const r=document.getElementById("nav");if(!r)return;const s=[{href:"cves.html",label:"CVEs",key:"cves"},{href:"exploits.html",label:"Exploits",key:"exploits"},{href:"fcc.html",label:"FCC",key:"fcc"},{href:"eol.html",label:"EOL Chips",key:"eol"}];r.innerHTML=`
    <a href="/" class="nav-logo">
      <div class="nav-chip-icon">IC</div>
      EOL-CHIP
    </a>
    <div class="nav-links">
      ${s.map(i=>`<a href="${i.href}"${t===i.key?' class="nav-active"':""}>${i.label}</a>`).join("")}
    </div>
  `}function o(t,r){return`<span class="tag ${t}">${r}</span>`}function l(t){return t?o("tag-sev-"+t.toLowerCase(),t):""}function f(t){if(!t)return"";const r=t.toLowerCase();return r.includes("active")?o("tag-status-active",t):r.includes("last buy")?o("tag-status-lastbuy",t):o("tag-eol",t)}export{f as a,c as i,l as s,o as t};
