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

    // Build display row objects once; filtering/sorting works on these
    var displayRows = rows.map(function(r){
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
      var sdateTime = 0;
      try {
        var pd = (window.parseTrackDate && typeof window.parseTrackDate === 'function') ? window.parseTrackDate(r.sdate) : new Date(r.sdate || 0);
        sdateTime = pd && !isNaN(pd.getTime()) ? pd.getTime() : 0;
      } catch(e){ sdateTime = 0; }
      var uid = r.uid !== undefined ? String(r.uid) : '';
      var userName = userMap[uid] || uid; // Use name if available
      var act = r.act || '';
      var changesHtml = formatAuditChanges(orig, neu);

      return { id: id, recId: recId, tbl: tbl, sdate: sdate, sdateTime: sdateTime, userName: userName, act: act, changesHtml: changesHtml };
    });

    // Default sort by sdateTime descending
    displayRows.sort(function(a,b){ return (b.sdateTime || 0) - (a.sdateTime || 0); });

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
      '.audit-filter-row input { width:100%; box-sizing:border-box; padding:4px 6px; border:1px solid #d0d7de; border-radius:3px; font-size:12px; }',
      '.audit-filter-row input:focus { outline:none; border-color:#0078d4; }',
      'th.sortable { cursor:pointer; user-select:none; }',
      'th.sortable:hover { background:#e1e5eb; }',
      'th.sort-asc::after { content:" ▲"; }',
      'th.sort-desc::after { content:" ▼"; }',
      '</style>',
      '</head><body>',
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">',
      '<h2 style="margin:0;">Audit Results (<span id="auditCount">' + displayRows.length + '</span> records)</h2>',
      '<div><button id="downloadXlsx">Download XLSX</button> <button id="closeBtn" style="background:#888;">Close</button></div>',
      '</div>',
      '<table id="auditTable"><thead>',
      '<tr>',
      '<th class="sortable" data-col="id" style="width:50px;">ID</th>',
      '<th class="sortable" data-col="recId" style="width:60px;">Record ID</th>',
      '<th class="sortable" data-col="tbl" style="width:80px;">Table</th>',
      '<th class="sortable" data-col="sdateTime" style="width:140px;">Date</th>',
      '<th class="sortable" data-col="userName" style="width:120px;">User</th>',
      '<th class="sortable" data-col="act" style="width:60px;">Action</th>',
      '<th class="sortable" data-col="changesHtml">Changes</th>',
      '</tr>',
      '<tr class="audit-filter-row">',
      '<th><input type="text" data-col="id" placeholder="Фильтр"></th>',
      '<th><input type="text" data-col="recId" placeholder="Фильтр"></th>',
      '<th><input type="text" data-col="tbl" placeholder="Фильтр"></th>',
      '<th><input type="text" data-col="sdate" placeholder="Фильтр"></th>',
      '<th><input type="text" data-col="userName" placeholder="Фильтр"></th>',
      '<th><input type="text" data-col="act" placeholder="Фильтр"></th>',
      '<th><input type="text" data-col="changesHtml" placeholder="Фильтр"></th>',
      '</tr>',
      '</thead><tbody></tbody></table>'
    ];

    var inlineScript = `
      var auditRows = ` + JSON.stringify(displayRows) + `;
      var auditFilters = {};
      var auditSort = { column: 'sdateTime', dir: -1 };

      function stripHtml(html){
        try {
          var tmp = document.createElement('div');
          tmp.innerHTML = html || '';
          return tmp.textContent || tmp.innerText || '';
        } catch(e) { return String(html || '').replace(/<[^>]+>/g, ' '); }
      }

      function renderAuditBody(){
        var filtered = auditRows.slice();

        // Apply per-column filters
        Object.keys(auditFilters).forEach(function(col){
          var val = auditFilters[col];
          if(val == null || val === '') return;
          var needle = String(val).toLowerCase();
          filtered = filtered.filter(function(row){
            var s = '';
            if(col === 'changesHtml') s = stripHtml(row.changesHtml);
            else s = row[col] || '';
            return String(s).toLowerCase().indexOf(needle) !== -1;
          });
        });

        // Apply sort
        if(auditSort.column){
          var col = auditSort.column;
          var dir = auditSort.dir;
          filtered.sort(function(a,b){
            var av = a[col], bv = b[col];
            if(col === 'sdateTime'){
              return ((a.sdateTime || 0) - (b.sdateTime || 0)) * dir;
            }
            if(av == null && bv == null) return 0;
            if(av == null) return 1 * dir;
            if(bv == null) return -1 * dir;
            var as = String(av).trim(), bs = String(bv).trim();
            if(as !== '' && bs !== '' && !isNaN(parseFloat(as)) && !isNaN(parseFloat(bs))){
              return (parseFloat(as) - parseFloat(bs)) * dir;
            }
            return String(av).localeCompare(String(bv), 'ru', { numeric: true }) * dir;
          });
        }

        // Update count label
        var countEl = document.getElementById('auditCount');
        if(countEl) countEl.textContent = String(filtered.length);

        // Render tbody
        var tbody = document.querySelector('#auditTable tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        filtered.forEach(function(row){
          var tr = document.createElement('tr');
          ['id','recId','tbl','sdate','userName','act'].forEach(function(col){
            var td = document.createElement('td');
            td.textContent = row[col] || '';
            tr.appendChild(td);
          });
          var tdChanges = document.createElement('td');
          tdChanges.className = 'change-list';
          tdChanges.innerHTML = row.changesHtml || '';
          tr.appendChild(tdChanges);
          tbody.appendChild(tr);
        });
      }

      function updateSortIndicators(){
        document.querySelectorAll('#auditTable thead th.sortable').forEach(function(th){
          th.classList.remove('sort-asc','sort-desc');
          if(th.dataset.col === auditSort.column){
            th.classList.add(auditSort.dir === 1 ? 'sort-asc' : 'sort-desc');
          }
        });
      }

      document.querySelectorAll('#auditTable thead th.sortable').forEach(function(th){
        th.addEventListener('click', function(){
          var col = th.dataset.col;
          if(auditSort.column === col) auditSort.dir = -auditSort.dir;
          else { auditSort.column = col; auditSort.dir = 1; }
          updateSortIndicators();
          renderAuditBody();
        });
      });

      document.querySelectorAll('#auditTable .audit-filter-row input').forEach(function(inp){
        inp.addEventListener('input', function(){
          auditFilters[inp.dataset.col] = inp.value;
          renderAuditBody();
        });
      });

      function downloadXLSX(){
        try{
          var headers = ["ID", "Record ID", "Table", "Date", "User", "Action", "Changes"];
          var ws_data = [headers];
          var trs = document.querySelectorAll("#auditTable tbody tr");
          trs.forEach(function(tr){
            var row = [];
            for(var i=0; i<6; i++) {
               row.push(tr.children[i].textContent || "");
            }
            var changeCell = tr.children[6];
            var changeText = changeCell.innerText || changeCell.textContent || "";
            changeText = changeText.replace(/\\n/g, " | ").replace(/\\s+/g, ' ').trim();
            row.push(changeText);
            ws_data.push(row);
          });

          // Try to use SheetJS loaded in parent window
          var XLSX = window.opener && window.opener.XLSX;
          if(typeof XLSX !== 'undefined' && XLSX && typeof XLSX.utils !== 'undefined'){
            var wb = XLSX.utils.book_new();
            var ws = XLSX.utils.aoa_to_sheet(ws_data);
            XLSX.utils.book_append_sheet(wb, ws, 'Audit');
            var wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            var blob = new Blob([wbout], { type: 'application/octet-stream' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var fname = 'audit_results_' + (new Date()).toISOString().replace(/[:\.]/g,'-') + '.xlsx';
            a.href = url; a.download = fname; document.body.appendChild(a); a.click();
            setTimeout(function(){ try{ URL.revokeObjectURL(url); if(a.parentNode) a.parentNode.removeChild(a); }catch(_){} }, 2000);
            return;
          }

          // Fallback to CSV if SheetJS is not available
          var csvRows = ws_data.map(function(r){ return r.map(function(c){ return '"' + String(c).replace(/"/g,'""') + '"'; }).join(","); });
          var csv = csvRows.join('\\n');
          var blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = "audit_results.csv";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
        }catch(e){ alert("XLSX export failed: " + e); }
      }

      document.getElementById('downloadXlsx').addEventListener('click', downloadXLSX);
      document.getElementById('closeBtn').addEventListener('click', function(){ window.close(); });

      renderAuditBody();
      updateSortIndicators();
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
