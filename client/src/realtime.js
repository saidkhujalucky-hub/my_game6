// Minimal event-based transport matching the subset of Socket.IO used by the game.
// Cloudflare Durable Objects speak ordinary WebSocket, without a separate Node server.
export function createGameSocket(endpoint='/game-ws') {
  const listeners=new Map(), pending=new Map();
  let ws=null, closed=false, retry=null, seq=0, attempts=0;
  const socket={connected:false};
  const emitLocal=(event,data)=>{for(const fn of listeners.get(event)||[])try{fn(data);}catch(err){console.error(err);}};
  const send=(event,data,callback,timeoutMode=false,timeoutMs=6000)=>{
    if(!socket.connected){
      if(callback)queueMicrotask(()=>timeoutMode?callback(new Error('Нет соединения'),null):callback({ok:false,error:'Сервер недоступен'}));
      return;
    }
    const id=callback?++seq:null;
    if(callback){
      const timer=setTimeout(()=>{
        pending.delete(id);
        if(timeoutMode)callback(new Error('Время ожидания истекло'),null);
        else callback({ok:false,error:'Сервер не ответил'});
      },timeoutMs);
      pending.set(id,{callback,timeoutMode,timer});
    }
    try{ws.send(JSON.stringify({type:event,data,requestId:id}));}
    catch(err){
      if(callback){const p=pending.get(id);if(p){clearTimeout(p.timer);pending.delete(id);}if(timeoutMode)callback(err,null);else callback({ok:false,error:'Ошибка отправки'});}
    }
  };
  const url=()=>{
    const target=new URL(endpoint,window.location.href);
    target.protocol=target.protocol==='https:'?'wss:':'ws:';
    return target.toString();
  };
  const connect=()=>{
    closed=false;
    if(ws && (ws.readyState===0||ws.readyState===1))return;
    let conn;
    try{conn=new WebSocket(url());ws=conn;}
    catch{return scheduleRetry();}
    conn.onopen=()=>{if(ws!==conn)return;attempts=0;socket.connected=true;emitLocal('connect');};
    conn.onmessage=e=>{if(ws!==conn)return;
      let m;try{m=JSON.parse(e.data);}catch{return;}
      if(m.type==='ack'){
        const p=pending.get(m.requestId);if(!p)return;
        clearTimeout(p.timer);pending.delete(m.requestId);
        p.timeoutMode?p.callback(null,m.result):p.callback(m.result);
      } else emitLocal(m.type,m.data);
    };
    conn.onerror=()=>{};
    conn.onclose=()=>{if(ws!==conn)return;
      if(socket.connected){socket.connected=false;emitLocal('disconnect');}
      for(const p of pending.values()){
        clearTimeout(p.timer);
        p.timeoutMode?p.callback(new Error('Связь потеряна'),null):p.callback({ok:false,error:'Соединение закрыто'});
      }
      pending.clear();
      if(!closed)scheduleRetry();
    };
  };
  const scheduleRetry=()=>{
    if(retry||closed)return;
    const delay=Math.min(7000,450*Math.pow(1.6,Math.min(attempts++,6)));
    retry=setTimeout(()=>{retry=null;connect();},delay);
  };
  socket.on=(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);return socket;};
  socket.off=(event,fn)=>{listeners.get(event)?.delete(fn);return socket;};
  socket.emit=(event,data,callback)=>{send(event,data,callback);return socket;};
  socket.timeout=ms=>({emit:(event,data,callback)=>send(event,data,callback,true,ms)});
  socket.connect=()=>{connect();return socket;};
  socket.disconnect=()=>{closed=true;if(retry){clearTimeout(retry);retry=null;}if(ws)ws.close(1000,'Leaving');if(socket.connected){socket.connected=false;emitLocal('disconnect');}return socket;};
  connect();
  return socket;
}
