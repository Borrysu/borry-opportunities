// 2026-11-20 正本搬到 https://borrysu.github.io/current/，這支 service worker 只負責把自己註銷，並清掉舊網址（/borry-opportunities/）底下的快取項目。
// 快取名稱和新網址共用，所以只刪舊路徑的項目，不整個刪快取。
self.addEventListener('install',function(e){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil((async function(){
  try{
    var names=await caches.keys();
    for(var i=0;i<names.length;i++){
      var c=await caches.open(names[i]), ks=await c.keys();
      for(var j=0;j<ks.length;j++){ if(new URL(ks[j].url).pathname.indexOf('/borry-opportunities/')===0) await c.delete(ks[j]); }
      if((await c.keys()).length===0) await caches.delete(names[i]);
    }
  }catch(err){}
  try{ await self.registration.unregister(); }catch(err){}
})());});
