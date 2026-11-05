import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

for (const source of ['mama']) {
  const repo = `traffic-ticket-${source}`;
  const { onRequestPost, sessionBelongsToSite } = await import('../functions/api/webhook.js');
  const prefix = source === 'mama' ? 'MA' : 'AM';
  const other = source === 'mama' ? 'amigo' : 'mama';
  const otherPrefix = source === 'mama' ? 'AM' : 'MA';
  test(`${source}: shared-account routing accepts own metadata or legacy reference only`, () => {
    assert.equal(sessionBelongsToSite({metadata:{source_site:source}},source),true);
    assert.equal(sessionBelongsToSite({client_reference_id:`${prefix}-ABC123`},source),true);
    assert.equal(sessionBelongsToSite({metadata:{source_site:other},client_reference_id:`${prefix}-ABC123`},source),false);
    assert.equal(sessionBelongsToSite({metadata:{source_site:source},client_reference_id:`${otherPrefix}-ABC123`},source),false);
    assert.equal(sessionBelongsToSite({client_reference_id:'TF-ABC123'},source),false);
    assert.equal(sessionBelongsToSite({},source),false);
  });
  async function deliver(session, {duplicate=false}={}) {
    const writes=[];
    const secret='local-test-signing-secret';
    const body=JSON.stringify({id:'evt_local_test',type:'checkout.session.completed',data:{object:session}});
    const timestamp=Math.floor(Date.now()/1000);
    const signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
    const response=await onRequestPost({request:new Request('https://example.test/api/webhook',{method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`},body}),env:{SITE_SOURCE:source,STRIPE_WEBHOOK_SECRET:secret,CASES:{get:async key=>duplicate&&key.startsWith('evt:')?'1':null,put:async(key)=>writes.push(key)}}});
    return {response,writes};
  }
  test(`${source}: signed events for another site make no case writes`,async()=>{
    const {response,writes}=await deliver({payment_status:'paid',metadata:{source_site:other}});
    assert.equal(response.status,200);
    assert.equal((await response.json()).ignored,true);
    assert.deepEqual(writes,[]);
  });
  test(`${source}: own paid event is processed; duplicate makes no writes`,async()=>{
    const session={id:'cs_local_test',payment_status:'paid',metadata:{source_site:source}};
    const first=await deliver(session);
    assert.equal(first.response.status,200);
    assert.ok(first.writes.some(key=>key.startsWith('case:')));
    const second=await deliver(session,{duplicate:true});
    assert.equal((await second.response.json()).duplicate,true);
    assert.deepEqual(second.writes,[]);
  });
  test(`${source}: missing, delayed, and unknown payment statuses never fulfill`,async()=>{
    for(const status of [undefined,'unpaid','no_payment_required','unexpected']){
      const {writes}=await deliver({payment_status:status,metadata:{source_site:source}});
      assert.deepEqual(writes,[]);
    }
  });
}
