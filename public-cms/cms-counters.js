/** นับเข้าชมข่าว / ดาวน์โหลด — cms_post_views, cms_download_counts */
(function () {
  function firestore() {
    return typeof db !== 'undefined' ? db : window.db;
  }

  async function bump(collection, docId) {
    const id = String(docId || '').trim();
    const fs = firestore();
    if (!id || !fs) return null;
    const ref = fs.collection(collection).doc(id);
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({ count: 1 });
        return 1;
      }
      const next = (Number(snap.data().count) || 0) + 1;
      await ref.update({ count: next });
      return next;
    } catch (e) {
      return null;
    }
  }

  async function fetchMap(collection, ids) {
    const map = {};
    const fs = firestore();
    if (!ids.length || !fs) return map;
    const unique = [...new Set(ids.map(String).filter(Boolean))];
    await Promise.all(
      unique.map(async (id) => {
        try {
          const snap = await fs.collection(collection).doc(id).get();
          map[id] = snap.exists ? Number(snap.data().count) || 0 : 0;
        } catch (e) {
          /* ignore */
        }
      })
    );
    return map;
  }

  window.CmsCounters = { bump, fetchMap };
})();
