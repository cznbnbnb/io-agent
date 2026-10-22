import { MaterialStore, MaterialSource, MaterialRevision } from './MaterialStore';

// Commit the sync tombstone before the caller removes any legacy source file.
// An unmigrated source needs only metadata: do not import text just to delete it.
export function markMaterialDeleted(store:MaterialStore,source:MaterialSource):MaterialRevision{
  const id=store.idFor(source.kind,source.name);
  const current=store.read(id)||store.ensure(source);
  if(current.operation==='delete')return current;
  return store.delete(id,current.revision);
}
