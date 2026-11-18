const {db,authenticated}=require('./auth/mercadolivre/_shared');
const handler=require('./affiliate-links');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 const cron=req.method==='GET'&&process.env.CRON_SECRET&&req.headers.authorization==='Bearer '+process.env.CRON_SECRET;
 if(!cron&&!authenticated(req))return res.status(401).json({ok:false,reason:'unauthorized'});
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 if(!process.env.FOX_ADMIN_KEY||!process.env.MANUS_API_KEY)return res.status(503).json({ok:false,reason:'manus_or_admin_not_configured'});
 const summary={ok:true,interval_minutes:5,automatic_polling:true,automatic_linkbuilder_queue:true,automatic_affiliate_generation:false,publication_enabled:false,polled:0,queued:0,errors:[]};
 try{
  const jobs=await db('fox_manus_jobs','GET',null,'?select=id,status,manus_task_id,product_url&status=in.(pending_manus,pending_review)&order=created_at.asc&limit=100');
  const due=jobs.filter(j=>j.status==='pending_manus'&&j.manus_task_id).slice(0,3);
  const invoke=async(action,job_id)=>{
   let status=200,payload=null;
   const fakeReq={method:'POST',query:{action},body:{job_id},headers:{authorization:'Bearer '+process.env.FOX_ADMIN_KEY}};
   const fakeRes={setHeader(){},status(n){status=n;return this},json(x){payload=x;return this},end(){return this}};
   await handler(fakeReq,fakeRes);
   if(status>=400||!payload?.ok)throw Error(payload?.reason||'action_failed');
   return payload;
  };
  for(const j of due){try{await invoke('manus_poll',j.id);summary.polled++}catch(e){summary.errors.push({job_id:j.id,stage:'poll',reason:e.message})}}
  const review=await db('fox_manus_jobs','GET',null,'?select=id,product_url&status=eq.pending_review&order=created_at.asc&limit=30');
  for(const j of review){try{await invoke('manus_to_linkbuilder',j.id);summary.queued++}catch(e){summary.errors.push({job_id:j.id,stage:'queue',reason:e.message})}}
  return res.json(summary);
 }catch(e){return res.status(502).json({...summary,ok:false,reason:'automation_cycle_failed'})}
};
