import{i as n}from"./common-j_SfgWpk.js";n("fcc");fetch("/data/fcc_devices.json").then(e=>e.json()).then(e=>{document.getElementById("fcc-count").textContent=e.length.toLocaleString();const o=document.getElementById("fcc-body");if(!e.length){o.innerHTML=`<tr><td colspan="6">
        <div class="empty-state">
          No FCC data — run <code>python scripts/fetch_fcc.py</code> to populate.
        </div>
      </td></tr>`;return}o.innerHTML=e.map(t=>`<tr>
      <td style="white-space:nowrap;font-family:monospace;font-size:12px">
        <a href="${t.url||"#"}" target="_blank" rel="noopener">${t.fcc_id||t.id||""}</a>
      </td>
      <td style="font-weight:500">${t.title||"—"}</td>
      <td style="color:var(--text2)">${t.grantee||"—"}</td>
      <td style="color:var(--text2);font-size:12px">${t.equipment_class||"—"}</td>
      <td style="color:var(--text3);font-size:12px">${t.frequency||"—"}</td>
      <td style="color:var(--text3);white-space:nowrap">${t.date||"—"}</td>
    </tr>`).join("")});
