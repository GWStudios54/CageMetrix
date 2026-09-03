// Local integration-test entry point only. Production still uses src/index.ts.
import worker from '../../src/index.ts';
import {syncLiveResults} from '../../src/live-results.ts';
const html=`<script data-drupal-selector="drupal-settings-json" type="application/json">{"eventLiveStats":{"event_fmid":"1326"}}</script><div class="c-listing-fight" data-fmid="12947"><div class="c-listing-fight__corner-name--red"><a href="/athlete/umar-nurmagomedov">Umar Nurmagomedov</a></div><div class="c-listing-fight__corner-name--blue"><a href="/athlete/song-yadong">Song Yadong</a></div></div>`;
const live={LiveEventDetail:{EventId:1326,FightCard:[{FightId:12947,Status:'Final',Fighters:[{Corner:'Red',Name:{FirstName:'Umar',LastName:'Nurmagomedov'},Outcome:{Outcome:'Loss'}},{Corner:'Blue',Name:{FirstName:'Song',LastName:'Yadong'},Outcome:{Outcome:'Win'}}],Result:{Method:'KO/TKO',EndingRound:2,EndingTime:'1:48'}}]}};
export default {async fetch(request:Request,env:any,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname==='/__test/results'){
    const failed=url.searchParams.has('fail');
    const source=async(input:any)=>failed?new Response('Source unavailable',{status:503}):String(input).includes('cloudfront.net')?Response.json(live):new Response(html,{'headers':{'content-type':'text/html'}});
    const status=await syncLiveResults(env,Date.now()+(failed?300000:0),source as typeof fetch);
    return Response.json(status);
  }
  return worker.fetch(request,env,ctx);
}};
