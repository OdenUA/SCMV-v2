// Audit functionality: send Audit requests and render human-friendly table in a new tab
(function(){
  // Ensure dependencies exist
  function safeGetId(id){ try{ return document.getElementById(id); }catch(e){ return null; } }
  var auditBtn = safeGetId('auditBtn');
  // Build audit request payload
  function buildAuditReq(tableName){
    var dateFrom = '';
    try{ dateFrom = buildLocalDateParam(dateFromInput && dateFromInput.value ? dateFromInput.value : '', false); }catch(e){ dateFrom = (dateFromInput && dateFromInput.value) ? dateFromInput.value : ''; }
    return {
      name: 'Audit',
      type: 'etbl',
      mid: 4,
      act: 'filter',
      filter: [ { selectedpgdatefrom: [ dateFrom ] }, { selectedtable: [ tableName ] } ],
      usr: authUser,
      pwd: authPwd,
      uid: authUid,
      lang: 'en'
    }; 
  }

  // Simple pretty formatter for auditorig/auditnewd strings: best-effort line breaks
  function prettifyAuditBlob(s){
    if(!s) return '';
    try{
      var t = String(s).trim();
      // remove leading/trailing braces
      if(t[0] === '{' && t[t.length-1] === '}') t = t.slice(1, -1);
      // insert line breaks before keys: find occurrences of ' "key"' or '"key"' patterns
      // We'll replace occurrences of '" ' (quote+space) that precede a '"' with '",\n"' — best-effort
      // First, ensure double quotes are present
      t = t.replace(/"\s+"/g, '",\n"');
      // Also put each key on new line if key starts with a quote
      t = t.replace(/\s*"([a-zA-Z0-9_]+)\":/g, '\n"$1":');
      t = t.replace(/^\n+/,'');
      return '{\n' + t + '\n}';
    }catch(e){ return String(s); }
  }

  // Render combined audit results into an HTML string and open in new tab
  function renderAuditWindow(results){
    // results: array of packets (responses) containing res[0].f
    var rows = [];
    results.forEach(function(pkt){
      try{
        if(!pkt || !pkt.res || !pkt.res[0] || !Array.isArray(pkt.res[0].f)) return;
        pkt.res[0].f.forEach(function(r){ rows.push(r); });
      }catch(e){}
    });
    // sort by sdate descending
    rows.sort(function(a,b){ try{ return new Date(b.sdate).getTime() - new Date(a.sdate).getTime(); }catch(e){ return 0; }});

    var html = ['<!doctype html><html><head><meta charset="utf-8"><title>Audit Results</title>',
      '<style>body{font-family:Arial,Helvetica,sans-serif;padding:14px;color:#222} table{border-collapse:collapse;width:100%} th,td{border:1px solid #ddd;padding:8px;vertical-align:top} th{background:#f6f6f6;text-align:left} pre{white-space:pre-wrap;font-family:monospace;font-size:12px;margin:0;background:#fff;padding:6px;border-radius:4px}</style>',
      '</head><body>', '<h2>Audit Results ('+rows.length+' records)</h2>',
      '<p><button id="downloadCsv">Download CSV</button> <button id="closeBtn">Close</button></p>',
      '<table id="auditTable"><thead><tr><th>ID</th><th>Table</th><th>Date</th><th>User</th><th>Action</th><th>Original</th><th>New</th></tr></thead><tbody>'];

    rows.forEach(function(r){
      var id = r.id !== undefined ? String(r.id) : '';
      var tbl = r.tbl || '';
      var sdate = r.sdate ? formatAnomalyTime(r.sdate) : (r.sdate || '');
      var uid = r.uid !== undefined ? String(r.uid) : '';
      var act = r.act || '';
      var orig = r.auditorig || '';
      var neu = r.auditnewd || '';
      html.push('<tr>');
      html.push('<td>'+escapeHtml(id)+'</td>');
      html.push('<td>'+escapeHtml(tbl)+'</td>');
      html.push('<td>'+escapeHtml(sdate)+'</td>');
      html.push('<td>'+escapeHtml(uid)+'</td>');
      html.push('<td>'+escapeHtml(act)+'</td>');
      html.push('<td><pre>'+escapeHtml(prettifyAuditBlob(orig))+'</pre></td>');
      html.push('<td><pre>'+escapeHtml(prettifyAuditBlob(neu))+'</pre></td>');
      html.push('</tr>');
    });

    html.push('</tbody></table>');
    // Add small script to support CSV download and close
      var inlineScript = `
        function downloadCSV(){
          try{
            var rows = [];
            var ths = document.querySelectorAll("#auditTable thead th");
            var headers = [];
            ths.forEach(function(h){ headers.push(h.textContent.trim()); });
            rows.push(headers.join(","));
            var trs = document.querySelectorAll("#auditTable tbody tr");
            trs.forEach(function(tr){
              var cells = [];
              Array.prototype.forEach.call(tr.children, function(td){
                var text = td.textContent || "";
                text = text.replace(/\n/g, " ").replace(/\s+/g, ' ').trim();
                cells.push('"' + text.replace(/"/g,'""') + '"');
              });
              rows.push(cells.join(","));
            });
            var csv = rows.join('\n');
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

  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Handler invoked by ws.js when Audit data arrives
  window.__handleAuditResponse = function(data){
    try{
      if(!window.__auditPending) return false;
      // we accept packets with name 'Audit'
      if(!data || data.name !== 'Audit') return false;
      // store packet
      window.__auditPending.received.push(data);
      // When we received both expected tables, or after a small timeout, render
      if(window.__auditPending.received.length >= window.__auditPending.expected){
        var recs = window.__auditPending.received.map(function(p){ return p; });
        // clear pending
        clearTimeout(window.__auditPending._timer);
        var cb = window.__auditPending._cb;
        window.__auditPending = null;
        try{ if(typeof cb === 'function') cb(recs); }catch(e){}
      }
      return true; // swallow packet
    }catch(e){ console.warn('audit handler error', e); return false; }
  };

  // Main send function: request both 'vehicle' and 'deviceconf' and render combined
  function requestAudit(){
    if(!authLoggedIn){ alert('Please login first'); return; }
    // prepare pending
    window.__auditPending = { expected: 2, received: [], _cb: function(recs){ renderAuditWindow(recs); }, _timer: null };
    // fallback timeout to render whatever we have after 6s
    window.__auditPending._timer = setTimeout(function(){ if(window.__auditPending){ var cb = window.__auditPending._cb; var recs = window.__auditPending.received.slice(); window.__auditPending = null; if(typeof cb==='function') cb(recs); } }, 6000);
    try{
      var req1 = buildAuditReq('vehicle');
      var req2 = buildAuditReq('deviceconf');
      // send them spaced slightly apart
      sendRequest(req1);
      setTimeout(function(){ sendRequest(req2); }, 150);
    }catch(e){ console.warn('send audit failed', e); }
  }

  // Wire button if present
  try{ if(auditBtn){ auditBtn.addEventListener('click', requestAudit); } }catch(e){ }
})();
