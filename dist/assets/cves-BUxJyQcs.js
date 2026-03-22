import{i as n,s as a}from"./common-j_SfgWpk.js";n("cves");function o(t){return t?t>=9?"var(--sev-critical)":t>=7?"var(--sev-high)":t>=4?"var(--sev-medium)":"var(--sev-low)":"var(--text3)"}fetch("/data/cves.json").then(t=>t.json()).then(t=>{document.getElementById("cve-count").textContent=t.length.toLocaleString();const r=document.getElementById("cve-body");if(!t.length){r.innerHTML=`<tr><td colspan="6">
        <div class="empty-state">
          No CVE data — run <code>python scripts/fetch_cves.py</code> to populate.
        </div>
      </td></tr>`;return}r.innerHTML=t.map(e=>`<tr>
      <td style="white-space:nowrap">
        <a href="${e.url||"#"}" target="_blank" rel="noopener">${e.id||""}</a>
      </td>
      <td><span class="truncate" style="max-width:320px">${e.title||""}</span></td>
      <td>${a(e.severity)}</td>
      <td style="font-weight:600;color:${o(e.cvss_score)}">${e.cvss_score||"—"}</td>
      <td style="color:var(--text3);font-size:12px">${e.cwe||"—"}</td>
      <td style="color:var(--text3);white-space:nowrap">${e.date||"—"}</td>
    </tr>`).join("")});
