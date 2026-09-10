import fs from 'node:fs';
import path from 'node:path';

export interface InetManifest { projectRoot:string; omnetppVersion:string; inetVersion:string; oppRunPath:string; iniPath:string; nedPath:string; resultDir:string }
export interface ManifestDiagnostic { code:string; message:string; field?:string }
export function normalizeWindowsPath(input:string):string { return path.normalize(input.replace(/^file:\/\//,'')); }
export function validateManifest(manifest: InetManifest, fsImpl: Pick<typeof fs,'existsSync'> = fs): ManifestDiagnostic[] {
 const d:ManifestDiagnostic[]=[]; const root=normalizeWindowsPath(manifest.projectRoot);
 if (!root) d.push({code:'PROJECT_ROOT_REQUIRED',message:'必须指定 INET 工程目录',field:'projectRoot'});
 for (const [field,value,code,label] of [['oppRunPath',manifest.oppRunPath,'OPP_RUN_MISSING','opp_run'],['iniPath',manifest.iniPath,'INI_MISSING','omnetpp.ini'],['nedPath',manifest.nedPath,'NED_MISSING','NED 目录']] as const) if (!value || !fsImpl.existsSync(normalizeWindowsPath(value))) d.push({code,message:`找不到必需的${label}`,field});
 if (!manifest.omnetppVersion) d.push({code:'OMNETPP_VERSION_REQUIRED',message:'必须指定 OMNeT++ 版本',field:'omnetppVersion'});
 if (!manifest.inetVersion) d.push({code:'INET_VERSION_REQUIRED',message:'必须指定 INET 版本',field:'inetVersion'});
 return d;
}
export function createManifest(input: Partial<InetManifest>): InetManifest { const root=normalizeWindowsPath(input.projectRoot||''); return {projectRoot:root,omnetppVersion:input.omnetppVersion||'',inetVersion:input.inetVersion||'',oppRunPath:normalizeWindowsPath(input.oppRunPath||path.join(root,'opp_run')),iniPath:normalizeWindowsPath(input.iniPath||path.join(root,'omnetpp.ini')),nedPath:normalizeWindowsPath(input.nedPath||path.join(root,'src')),resultDir:normalizeWindowsPath(input.resultDir||path.join(root,'results'))}; }
