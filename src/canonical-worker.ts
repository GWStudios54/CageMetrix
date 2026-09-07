import app from './worker.ts';
import {canonicalRedirect} from './search-ctr.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};

export default {
  async fetch(request:Request,env:Env,context:ExecutionContext):Promise<Response>{
    const redirect=canonicalRedirect(request);
    return redirect||app.fetch(request,env,context);
  },
  async scheduled(controller:ScheduledController,env:Env,context:ExecutionContext){
    return app.scheduled(controller,env,context);
  }
} satisfies ExportedHandler<Env>;
