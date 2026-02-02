// Audit functionality: send Audit requests and render human-friendly table in a new tab
(function(){
  // Ensure dependencies exist
  function safeGetId(id){ try{ return document.getElementById(id); }catch(e){ return null; } }
  var auditBtn = safeGetId('auditBtn');

  // Build audit request payload
  function buildAuditReq(tableName){
    var dateFrom = '';
    // Global dateFromInput might be available
    var inp = safeGetId('dateFrom'); 
    try{ dateFrom = buildLocalDateParam(inp && inp.value ? inp.value : '', false); }catch(e){ dateFrom = (inp && inp.value) ? inp.value : ''; }
    
    // Fallback to defaults or global auth vars
    return {
      name: 'Audit',
      type: 'etbl',
      mid: 4,
      act: 'filter',
      filter: [ { selectedpgdatefrom: [ dateFrom ] }, { selectedtable: [ tableName ] } ],
      usr: window.authUser,
      pwd: window.authPwd,
      uid: window.authUid,
      lang: 'en'
    }; 
  }

  // Robust parser for broken JSON from audit logs
  function parseAuditJson(str) {
    if (!str) return null;
    try {
        // First try standard parse
        return JSON.parse(str);
    } catch(e) {
        // Fallback: fix missing commas
        var s = String(str).trim();
        if (s.startsWith('{')) s = s.substring(1);
        if (s.endsWith('}')) s = s.substring(0, s.length - 1);
        s = s.trim();
        // Insert commas between value-ends and next key
        // value-ends: digit, quote, 'e' (true/false), 'l' (null), '}', ']'
        // We look for patterns like: val "nextkey":
        s = s.replace(/([0-9"l}e])\s*("[\w]+":)/g, '$1,$2');
        try {
            return JSON.parse('{' + s + '}');
        } catch(e2) {
            return null; // Give up
        }
    }
  }

  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Compare two objects and return HTML summary
  function formatAuditChanges(origStr, newStr) {
    var oldObj = parseAuditJson(origStr);
    var newObj = parseAuditJson(newStr);
    
    // If parsing failed for both, and they are empty/null
    if (!oldObj && !newObj) {
        if (origStr || newStr) return '<i style="color:gray; font-size:10px;">Raw (parse error)</i>'; 
        return ''; 
    }
    
    if (!oldObj) oldObj = {};
    if (!newObj) newObj = {};
    
    var changes = [];
    var allKeys = {};
    for (var k in oldObj) allKeys[k] = true;
    for (var k in newObj) allKeys[k] = true;
    
    for (var k in allKeys) {
        if (k === 'sdate') continue; 
        
        var vOld = oldObj[k];
        var vNew = newObj[k];
        
        // Simple string comparison
        if (JSON.stringify(vOld) !== JSON.stringify(vNew)) {
            var dispOld = (vOld === undefined) ? '<i>(null)</i>' : escapeHtml(String(vOld));
            var dispNew = (vNew === undefined) ? '<i>(deleted)</i>' : escapeHtml(String(vNew));
            
            changes.push('<div style="margin-bottom:2px;"><span style="color:#666;font-weight:bold;">' + escapeHtml(k) + ':</span> ' + dispOld + ' &rarr; <b>' + dispNew + '</b></div>');
        }
    }
    
    if (changes.length === 0) return '<i>No changes</i>';
    return changes.join('');
  }

  // Render combined audit results into an HTML string and open in new tab
  function renderAuditWindow(results){
    // 1. Extract User Map
    var userMap = {};
    var auditPackets = [];

    results.forEach(function(pkt){
        if (pkt && pkt.name === 'User Admin Edit') {
            try {
                if (pkt.res && pkt.res[0] && Array.isArray(pkt.res[0].f)) {
                    pkt.res[0].f.forEach(function(u) {
                        if (u.uid) userMap[String(u.uid)] = u.fname || u.usr || ('User ' + u.uid);
                    });
                }
            } catch (e) {}
        } else {
            auditPackets.push(pkt);
        }
    });

    // results: array of packets (responses) containing res[0].f
    var rows = [];
    auditPackets.forEach(function(pkt){
      try{
        if(!pkt || !pkt.res || !pkt.res[0] || !Array.isArray(pkt.res[0].f)) return;
        pkt.res[0].f.forEach(function(r){ rows.push(r); });
      }catch(e){}
    });
    // sort by sdate descending
    rows.sort(function(a,b){ try{ return new Date(b.sdate).getTime() - new Date(a.sdate).getTime(); }catch(e){ return 0; }});

    var html = ['<!doctype html><html><head><meta charset="utf-8"><title>Audit Results</title>',
      '<style>',
      'body{font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; padding:20px; color:#333; background-color: #f9f9f9;}',
      'table{border-collapse:collapse; width:100%; box-shadow: 0 2px 5px rgba(0,0,0,0.1); background: #fff;}',
      'th,td{border:1px solid #ddd; padding:10px 12px; vertical-align:top; font-size: 14px;}',
      'th{background:#f1f1f1; text-align:left; font-weight: 600; color: #555;}',
      'tr:nth-child(even) {background-color: #fcfcfc;}',
      'tr:hover {background-color: #f1f7ff;}',
      'button {padding: 8px 16px; cursor: pointer; background: #0078d4; color: white; border: none; border-radius: 4px; font-size: 14px;}',
      'button:hover {background: #0060aa;}',
      '.change-list div { white-space: normal; word-break: break-all; }', 
      '</style>',
      '</head><body>', 
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">',
      '<h2 style="margin:0;">Audit Results ('+rows.length+' records)</h2>',
      '<div><button id="downloadCsv">Download CSV</button> <button id="closeBtn" style="background:#888;">Close</button></div>',
      '</div>',
      '<table id="auditTable"><thead><tr>',
      '<th style="width:50px;">ID</th>',
      '<th style="width:60px;">Record ID</th>',
      '<th style="width:80px;">Table</th>',
      '<th style="width:140px;">Date</th>',
      '<th style="width:120px;">User</th>',
      '<th style="width:60px;">Action</th>',
      '<th>Changes</th>',
      '</tr></thead><tbody>'
    ];

    rows.forEach(function(r){
      var id = r.id !== undefined ? String(r.id) : '';
      var orig = r.auditorig || '';
      var neu = r.auditnewd || '';
      
      // Try to find Record ID from auditorig -> id
      var recId = '';
      var parsed = parseAuditJson(orig);
      if(parsed && parsed.id !== undefined) recId = parsed.id;
      else {
          recId = (r.recid !== undefined) ? r.recid : 
                  (r.objid !== undefined) ? r.objid : 
                  (r.rowid !== undefined) ? r.rowid : 
                  (r.did !== undefined) ? r.did : 
                  (r.val !== undefined) ? r.val : '';
      }
      recId = String(recId);

      var tbl = r.tbl || '';
      var sdate = r.sdate ? (window.formatAnomalyTime ? window.formatAnomalyTime(r.sdate) : r.sdate) : (r.sdate || '');
      var uid = r.uid !== undefined ? String(r.uid) : '';
      var userName = userMap[uid] || uid; // Use name if available
      
      var act = r.act || '';
      
      // Calculate changes
      var changesHtml = formatAuditChanges(orig, neu);

      html.push('<tr>');
      html.push('<td>'+escapeHtml(id)+'</td>');
      html.push('<td>'+escapeHtml(recId)+'</td>');
      html.push('<td>'+escapeHtml(tbl)+'</td>');
      html.push('<td>'+escapeHtml(sdate)+'</td>');
      html.push('<td>'+escapeHtml(userName)+'</td>');
      html.push('<td>'+escapeHtml(act)+'</td>');
      html.push('<td class="change-list">'+changesHtml+'</td>');
      html.push('</tr>');
    });

    html.push('</tbody></table>');
    
    // Add script for CSV
      var inlineScript = `
        function downloadCSV(){
          try{
            var rows = [];
            // headers
            var headers = ["ID", "Record ID", "Table", "Date", "User", "Action", "Changes"];
            rows.push(headers.join(","));
            
            var trs = document.querySelectorAll("#auditTable tbody tr");
            trs.forEach(function(tr){
              var cells = [];
              // Standard cells
              for(var i=0; i<6; i++) {
                 var text = tr.children[i].textContent || "";
                 cells.push('"' + text.replace(/"/g,'""') + '"');
              }
              // Changes cell: extract text properly
              var changeCell = tr.children[6];
              var changeText = changeCell.innerText || changeCell.textContent || "";
              changeText = changeText.replace(/\\n/g, " | ").replace(/\\s+/g, ' ').trim();
              cells.push('"' + changeText.replace(/"/g,'""') + '"');
              
              rows.push(cells.join(","));
            });
            var csv = rows.join('\\n');
            var blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = "audit_results.csv";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
          }catch(e){ alert("CSV export failed: " + e); }
        }
        document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
        document.getElementById('closeBtn').addEventListener('click', function(){ window.close(); });
      `;
      html.push('<script>' + inlineScript + '<' + '/script>');

    html.push('</body></html>');
    var w = window.open('about:blank','_blank');
    if(!w){ alert('Popup blocked. Allow popups for this site to view audit results.'); return; }
    w.document.open(); w.document.write(html.join('\n')); w.document.close();
  }

  // Handler invoked by ws.js when Audit data arrives
  window.__handleAuditResponse = function(data){
    try{
      if(!window.__auditPending) return false;
      if(!data || (data.name !== 'Audit' && data.name !== 'User Admin Edit')) return false;
      window.__auditPending.received.push(data);
      if(window.__auditPending.received.length >= window.__auditPending.expected){
        var recs = window.__auditPending.received.map(function(p){ return p; });
        clearTimeout(window.__auditPending._timer);
        var cb = window.__auditPending._cb;
        window.__auditPending = null;
        try{ if(typeof cb === 'function') cb(recs); }catch(e){}
      }
      return true; // swallow packet
    }catch(e){ console.warn('audit handler error', e); return false; }
  };

  // Main send function
  function requestAudit(){
    if(!window.authLoggedIn){ alert('Please login first'); return; }
    window.__auditPending = { expected: 3, received: [], _cb: function(recs){ renderAuditWindow(recs); }, _timer: null };
    window.__auditPending._timer = setTimeout(function(){ if(window.__auditPending){ var cb = window.__auditPending._cb; var recs = window.__auditPending.received.slice(); window.__auditPending = null; if(typeof cb==='function') cb(recs); } }, 6000);
    try{
      var reqUser = {
        name: 'User Admin Edit',
        type: 'etbl',
        mid: 2,
        act: 'setup',
        filter: [],
        nowait: true,
        waitfor: [],
        usr: window.authUser,
        pwd: window.authPwd,
        uid: window.authUid,
        lang: 'en'
      };
      var req1 = buildAuditReq('vehicle');
      var req2 = buildAuditReq('deviceconf');
      if(window.sendRequest) {
          window.sendRequest(reqUser);
          setTimeout(function(){ window.sendRequest(req1); }, 100);
          setTimeout(function(){ window.sendRequest(req2); }, 200);
      } else {
          console.error("sendRequest is not defined");
      }
    }catch(e){ console.warn('send audit failed', e); }
  }

  // Wire button
  try{ if(auditBtn){ auditBtn.addEventListener('click', requestAudit); } }catch(e){ }
})();
