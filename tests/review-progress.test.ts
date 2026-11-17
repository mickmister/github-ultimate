import {expect,test} from 'vitest';
import {responseRun} from '../src/review-progress';
const version='a'.repeat(40), repo='example/source', branch='pilot';
const run={id:1,html_url:'https://github.com/example/source/actions/runs/1',event:'workflow_dispatch',head_branch:branch,actor:{id:7},display_title:`QRSPI pilot · ${version} · 1`,status:'in_progress',conclusion:null};
test('only an exact response, source branch and authenticated actor can be correlated',()=>{
  expect(responseRun([run],version,repo,branch,7)).toMatchObject({state:'running',run:{id:1}});
  for(const altered of [{...run,display_title:'QRSPI pilot · 1'},{...run,head_branch:'other'},{...run,actor:{id:8}},{...run,display_title:`QRSPI pilot · ${version}more · 1`}])
    expect(responseRun([altered],version,repo,branch,7).state).toBe('not-found');
  expect(responseRun([run,{...run,id:2}],version,repo,branch,7).state).toBe('unknown');
  expect(()=>responseRun([{...run,html_url:'https://evil.invalid/'}],version,repo,branch,7)).toThrow('Invalid workflow');
  expect(responseRun([{...run,status:'completed',conclusion:'failure'}],version,repo,branch,7)).toMatchObject({state:'completed',run:{conclusion:'failure'}});
});
