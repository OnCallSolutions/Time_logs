/**
 * Deduplicates scoped browser reads and optionally retains short-lived results.
 * Cache values live only in memory; permissions and mutations remain uncached.
 * Account keys and explicit invalidation prevent cross-account result reuse.
 */
const reads=new Map<string,{expires:number;value:Promise<unknown>}>()
/**
 * Loads authorized JSON with bounded in-memory retention and concurrent reuse.
 * @param url - Relative application endpoint.
 * @param scope - Authenticated identity isolating this read from other accounts.
 * @param maxAge - Retention in milliseconds; zero only deduplicates concurrent reads.
 * @returns Promise of validated successful response JSON; failures are not cached.
 */
export function readClientData<T>(url:string,scope:string,maxAge=0):Promise<T>{
  const key=`${scope.toLowerCase()}:${url}`,existing=reads.get(key)
  if(existing&&existing.expires>Date.now())return existing.value as Promise<T>
  const record={expires:Infinity,value:Promise.resolve(undefined) as Promise<unknown>}
  record.value=fetch(url,{cache:"no-store"}).then(async response=>{
    const value=await response.json()
    if(!response.ok)throw new Error(value.error||"Unable to load records.")
    record.expires=Date.now()+Math.min(Math.max(maxAge,0),30000)
    return value
  }).catch(error=>{if(reads.get(key)===record)reads.delete(key);throw error})
  if(reads.size>=100)reads.delete(reads.keys().next().value!)
  reads.set(key,record);return record.value as Promise<T>
}
/**
 * Invalidates data after mutations, sign-out, or an explicit refresh.
 * @param scope - Optional account to invalidate; omitted clears all browser reads.
 * @param url - Optional endpoint to invalidate within an account.
 * @returns void; in-flight values cannot reinsert themselves into the cache.
 */
export function invalidateClientData(scope?:string,url?:string):void{
  for(const key of reads.keys())if(!scope||key.startsWith(`${scope.toLowerCase()}:`)&&(!url||key===`${scope.toLowerCase()}:${url}`))reads.delete(key)
}
