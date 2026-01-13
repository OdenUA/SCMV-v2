// test_ws.js - Raw WebSocket request tester migrated from main page functionality
(function(){
  const wsUrl = "wss://scmv.vpngps.com:4445";
  const statusDiv = document.getElementById('status');
  const rawRequestInput = document.getElementById('rawRequestInput');
  const rawRequestSendBtn = document.getElementById('rawRequestSend');
  const rawRequestClearBtn = document.getElementById('rawRequestClear');
  const rawResponseLog = document.getElementById('rawResponseLog');

  let socket;

  function appendRawLog(text, direction){
    if (!rawResponseLog) return;
    const ts = new Date().toISOString().slice(11,19);
    const line = document.createElement('div');
    line.textContent = `[${ts}] ${text}`;
    line.style.padding = '2px 0';
    line.style.color = direction === 'out' ? '#6ee7b7' : '#93c5fd';
    rawResponseLog.appendChild(line);
    rawResponseLog.scrollTop = rawResponseLog.scrollHeight;
  }

  function connect(){
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      statusDiv.textContent = 'Connected';
      statusDiv.style.color = 'green';
    };
    socket.onmessage = (event) => {
      appendRawLog('⬅ ' + event.data, 'in');
    };
    socket.onerror = (err) => {
      statusDiv.textContent = 'Error';
      statusDiv.style.color = 'red';
      appendRawLog('⚠ Socket error: ' + err.message, 'in');
    };
    socket.onclose = () => {
      statusDiv.textContent = 'Closed. Reconnecting...';
      statusDiv.style.color = 'orange';
      setTimeout(connect, 5000);
    };
  }

  function sendRawRequest(){
    if (!rawRequestInput) return;
    let value = rawRequestInput.value.trim();
    if (!value){
      appendRawLog('⚠ Пустой ввод', 'in');
      return;
    }
    if (value.startsWith('send:')) value = value.slice(5);
    let obj;
    try { obj = JSON.parse(value); } catch(e){
      appendRawLog('⚠ Ошибка парсинга JSON: '+e.message, 'in');
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN){
      appendRawLog('⚠ WebSocket не подключен', 'in');
      return;
    }
    const payload = JSON.stringify(obj);
    socket.send(payload);
    appendRawLog('➡ ' + payload, 'out');
  }

  if (rawRequestSendBtn){
    rawRequestSendBtn.addEventListener('click', sendRawRequest);
  }
  if (rawRequestClearBtn){
    rawRequestClearBtn.addEventListener('click', ()=>{
      if (rawResponseLog) rawResponseLog.innerHTML = '(лог пуст)';
    });
  }
  if (rawRequestInput){
    rawRequestInput.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        if (!e.shiftKey){
          e.preventDefault();
          sendRawRequest();
        }
      }
    });
  }

  connect();
})();
