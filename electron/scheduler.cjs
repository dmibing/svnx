const path = require("node:path");
function overlap(a, b) {
  a = path.resolve(a).toLowerCase();
  b = path.resolve(b).toLowerCase();
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}
class Scheduler {
  pending = [];
  active = new Map();
  limit = 2;
  submit(id, root, job) {
    return new Promise((resolve, reject) => {
      this.pending.push({
        id,
        root,
        job,
        resolve,
        reject,
        controller: new AbortController(),
      });
      this.drain();
    });
  }
  cancel(id) {
    const index = this.pending.findIndex((j) => j.id === id);
    if (index !== -1) {
      const [job] = this.pending.splice(index, 1);
      job.reject(
        Object.assign(new Error("排队任务已取消"), { code: "CANCELLED" }),
      );
    }
    this.active.get(id)?.controller.abort();
  }
  drain() {
    for (let i = 0; i < this.pending.length && this.active.size < this.limit;) {
      const job = this.pending[i];
      if ([...this.active.values()].some((j) => overlap(j.root, job.root))) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      this.active.set(job.id, job);
      Promise.resolve()
        .then(() => job.job(job.controller.signal))
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active.delete(job.id);
          this.drain();
        });
    }
  }
  close() {
    for (const j of [...this.pending, ...this.active.values()])
      this.cancel(j.id);
  }
}
module.exports = { Scheduler, overlap };
