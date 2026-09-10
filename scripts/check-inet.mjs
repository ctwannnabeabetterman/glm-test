import fs from 'node:fs';
import process from 'node:process';
const root=process.env.INET_PROJECT_ROOT||process.cwd(); const checks=[['projectRoot',root],['oppRunPath',process.env.OPP_RUN_PATH||`${root}/opp_run`],['iniPath',`${root}/omnetpp.ini`]]; const diagnostics=checks.filter(([,p])=>!fs.existsSync(p)).map(([field])=>({code:'MISSING_PATH',field,message:`找不到 ${field}`})); const out={ok:diagnostics.length===0,diagnostics}; console.log(process.argv.includes('--json')?JSON.stringify(out,null,2):out.ok?'INET 可运行':'INET 不可运行'); process.exitCode=out.ok?0:1;
