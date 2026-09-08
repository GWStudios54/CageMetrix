export const INTEL_SOURCE_POLICY = [
  {slug:'verified-profile',kind:'verified_profile',priority:100,official:true,label:'Verified fighter / representative profile'},
  {slug:'management-rosters',kind:'official_management',priority:100,official:true,label:'Official management agency roster'},
  {slug:'promotion-sites',kind:'official_promotion',priority:95,official:true,label:'Official promotion source'},
  {slug:'team-sites',kind:'official_team',priority:95,official:true,label:'Official gym / team source'},
  {slug:'commissions',kind:'commission',priority:95,official:true,label:'Athletic commission or public regulatory record'},
  {slug:'fighter-public',kind:'fighter_public',priority:90,official:true,label:'Fighter public professional channel'},
  {slug:'mma-master',kind:'warehouse',priority:80,official:false,label:'MMA Scouts normalized fight warehouse'},
  {slug:'credible-media',kind:'credible_media',priority:70,official:false,label:'Credible MMA reporting'}
];

export const INTEL_FIELD_CATALOG = [
  ['identity.dob','identity','Date of birth'],
  ['identity.nationality','identity','Nationality'],
  ['physical.height','physical','Height'],
  ['physical.reach','physical','Reach'],
  ['physical.stance','physical','Stance'],
  ['team.primary','team','Gym / team'],
  ['career.organization','career','Current organization'],
  ['career.promotion','career','Tracked promotion'],
  ['career.weight_class','career','Current weight class'],
  ['career.start','career','Career start'],
  ['career.last_fight','career','Last fight'],
  ['management.current','management','Management'],
  ['contract.status','contract','Contract status'],
  ['availability.fights','availability','Fight availability'],
  ['availability.management','availability','Open to management'],
  ['availability.team','availability','Open to team offers'],
  ['location.base','location','Training / professional base'],
  ['contact.professional','contact','Public professional contact']
].map(([key,category,label])=>({key,category,label}));

export function confidenceLabel(value){return value==='A'?'Primary / verified':value==='B'?'Strong secondary':'Unconfirmed public record';}

export function safeProfessionalUrl(value){
  if(!value)return null;
  try{const url=new URL(String(value));return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}
}
