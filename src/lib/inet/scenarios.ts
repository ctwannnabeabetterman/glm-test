export type ScenarioType='b5g-mesh'|'indoor-beamforming'|'uav-ad-hoc'|'sat-air-ground';
export interface ScenarioTemplate { type:ScenarioType; name:string; description:string; parameters:Record<string,unknown>; recommendedNodePairs:[string,string][]; metrics:string[] }
const base={topology:{nodeCount:4, coordinates:[[0,0,0],[10,0,0],[0,10,0],[10,10,0]]},mobility:{speed:0},radio:{frequencyGHz:3.5,bandwidthMHz:100},beamforming:{codebookIndex:0},traffic:{packetRate:100,packetSize:512},failure:{lossRate:0},randomSeed:42};
export const SCENARIO_TEMPLATES: Record<ScenarioType,ScenarioTemplate>={
 'b5g-mesh':{type:'b5g-mesh',name:'B5G Mesh',description:'5G 后五代多节点网状网络',parameters:base,recommendedNodePairs:[['node[0]','node[1]']],metrics:['pdr','throughput','latency','jitter']},
 'indoor-beamforming':{type:'indoor-beamforming',name:'Indoor Beamforming',description:'室内毫米波波束成形',parameters:{...base,radio:{frequencyGHz:28,bandwidthMHz:400},beamforming:{codebookIndex:3}},recommendedNodePairs:[['ue[0]','ap[0]']],metrics:['sinr','throughput','latency']},
 'uav-ad-hoc':{type:'uav-ad-hoc',name:'UAV Ad-hoc',description:'无人机自组织网络',parameters:{...base,topology:{...base.topology,nodeCount:5},mobility:{speed:15,altitude:120}},recommendedNodePairs:[['uav[0]','uav[1]']],metrics:['coverage','connectivity','energy']},
 'sat-air-ground':{type:'sat-air-ground',name:'Satellite Air Ground',description:'天地一体化链路',parameters:{...base,satellite:{windowSeconds:600,altitudeKm:550}},recommendedNodePairs:[['satellite[0]','ground[0]']],metrics:['pdr','latency','handover']}
};
export function getScenarioTemplate(type:ScenarioType){return SCENARIO_TEMPLATES[type];}
