const BASE = '';

export async function fetchCluster()    { return (await fetch(`${BASE}/api/cluster`)).json(); }
export async function fetchNodes(q={})  {
  const qs = new URLSearchParams(q).toString();
  return (await fetch(`${BASE}/api/nodes${qs?`?${qs}`:''}`)).json();
}
export async function fetchShards()     { return (await fetch(`${BASE}/api/shards`)).json(); }
export async function fetchProfiler(q={}){
  const qs = new URLSearchParams(q).toString();
  return (await fetch(`${BASE}/api/profiler${qs?`?${qs}`:''}`)).json();
}
export async function fetchReplicaSets(q={}){
  const qs = new URLSearchParams(q).toString();
  return (await fetch(`${BASE}/api/replicasets${qs?`?${qs}`:''}`)).json();
}
