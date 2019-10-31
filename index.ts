import axios from "axios";
import { readJson, ensureDir } from "fs-extra";
import { fork } from "child_process";

const { login: USER_LOGIN, password: USER_PASS } = require("./details.json");

const DAY_MS = 24 * 60 * 60 * 1000;
let Cookie: string;

type Worker = {
  run: (opts: {
    listener: (m: any) => any;
    errHandler: (e: any) => any;
  }) => { send: (m: any) => void; release: () => void };
  stop: () => void;
};

const newWorker = (js: string): Worker => {
  const cp = fork(js, [], {
    stdio: ["pipe", "pipe", "pipe", "ipc"]
  });

  interface State {
    busy: boolean;
    ok: boolean;
    err?: any;
    listener: (m: any) => void;
    errHandler: (e: any) => void;
  }

  const _defaulListener = (_: any) => {};

  const st = ({
    busy: false,
    ok: true,
    err: undefined,
    listener: _defaulListener,
    errHandler: undefined
  } as unknown) as State;

  const _defaultErrHandler = (e: any) => {
    st.ok = false;
    st.busy = false;
    st.err = e;
  };

  st.errHandler = _defaultErrHandler;

  cp.stdout!.on("data", chunk =>
    console.log(`worker-out: ${chunk.toString()}`)
  );
  cp.stderr!.on("data", chunk =>
    console.log(`worker-out: ${chunk.toString()}`)
  );

  cp.on("error", (e: any) => {
    _defaultErrHandler(e);
    st.errHandler(e);
  });

  cp.on("message", (m: any) => st.listener(m));

  return {
    stop: () => {
      cp.send({ type: "kill" });
    },
    run: ({
      listener,
      errHandler
    }: {
      listener: (m: any) => any;
      errHandler: (e: any) => any;
    }) => {
      if (st.busy) {
        throw new Error("worker is busy");
      }

      if (!st.ok) {
        throw st.err;
      }

      st.busy = true;
      st.listener = listener;
      st.errHandler = errHandler;

      const send: (m: any) => void = (m: any) => {
        cp.send({ type: "download", data: m });
      };

      return {
        send,
        release: () => {
          st.busy = false;
          st.listener = _defaulListener;
          st.errHandler = _defaultErrHandler;
        }
      };
    }
  };
};

const url = {
  login: () => `https://pickmyrec.com/api.php/session`
};

const login = async (login: string, password: string) =>
  axios
    .post(
      url.login(),
      { login, password },
      {
        headers: {
          Accept: "application/json, text/plain, */*"
        }
      }
    )
    .then(({ headers, status }) => {
      if (status !== 200) return null;
      let setCookie: Array<string> | string = headers["set-cookie"];
      if (setCookie instanceof Array) setCookie = setCookie.join("\n");
      const m = setCookie.match(/SESS=(\w+);/);
      if (m === null) return null;
      return m![1];
    });

const downloadRelease = (
  { run }: Worker,
  id: number,
  listener?: (m: { type: string; data: any }) => void
) =>
  new Promise<string>((resolve, reject) => {
    const userListener = listener;
    const { send, release } = run({
      listener: (m: any) => {
        if (userListener !== undefined) userListener(m);
        if (m.type === "end") {
          resolve(m);
          release();
        }
      },
      errHandler: reject
    });

    send({ id, Cookie });
  });

const downloadQueue = async (
  releaseIds: number[],
  nWorkers: number,
  listener: (id: number, m: { type: string; data: any }) => void
) => {
  console.log("releases", releaseIds);
  console.log("nWorkers", nWorkers);

  const handler = async (path: string) => {
    let w = newWorker(path);
    while (releaseIds.length > 0) {
      const [id] = releaseIds.splice(releaseIds.length - 1, 1);
      try {
        console.debug(`starting download of release id ${id}`);
        await downloadRelease(w, id, m => listener(id, m));
      } catch (e) {
        console.log(`worker error, restarting worker...`);
        console.debug(e);
        w.stop();
        w = newWorker(path);
      }
    }
    w.stop();
  };

  const tasks = [];
  for (let i = 0; i < nWorkers; i++) {
    tasks.push(handler("./worker.js"));
  }

  await Promise.all(tasks);
};

interface Category {
  nm: string;
  selected: boolean;
}

interface Track {
  id: number;
  tracks: Array<{ category: string; filesize: number }>;
  totalsize: number;
}

const releases = async (date: Date, bytes: number, categories: any) => {
  const res: Track[] = [];
  const selectedCategories: string[] = categories.filter((c: any) => {
    if (c.selected) return c.nm;
  });

  let n = 0;
  while (n < bytes) {
    res.forEach(element => {
      element.tracks.forEach(track => {
        n += track.filesize;
      });
    });
    const ts = date.toISOString();
    const match = ts.match(/(\d+)\-(\d+)\-(\d+)/);
    if (match === null) break;
    const [param] = match;
    const { data } = await axios.get(
      `https://srv.pickmyrec.com/a/ms/section/beatport/media?date=${param}&mp3prefered=false&popular_order=true`,
      {
        headers: {
          Accept: "application/json",
          Cookie
        }
      }
    );

    res.push(
      ...data.releases
        .filter((r: any) => !r.downloaded)
        .filter(
          () =>
            categories.map((r: any) => ({
              id: r.id as number,
              tracks: r.tracks
                .filter((t: any) =>
                  t.some((track: any) =>
                    selectedCategories.some(
                      (selected: any) => track == selected
                    )
                  )
                )
                .map((t: any) => ({
                  category: t.category_nm,
                  filesize: t.filesize
                }))
            })) as Track[]
        )
    );

    date.setUTCMilliseconds(date.getUTCMilliseconds() - DAY_MS);
  }
  return res;
};

const scene = async (date: Date, bytes: number) => {
  const res: Track[] = [];
  let n = 0;
  while (n < bytes) {
    console.log("n=", n);
    res.forEach(element => {
      element.tracks.forEach(track => {
        n += track.filesize;
      });
    });
    const ts = date.toISOString();
    const match = ts.match(/(\d+)\-(\d+)\-(\d+)/);
    if (match === null) break;
    const [param] = match;
    const { data } = await axios.get(
      `https://srv.pickmyrec.com/a/ms/section/scene/media?date=${param}&mp3prefered=false&popular_order=true`,
      {
        headers: {
          Accept: "application/json",
          Cookie
        }
      }
    );

    res.push(
      ...(data.releases.map((r: any) => ({
        id: r.id as number,
        tracks: r.tracks.map((t: any) => ({
          category: t.category_nm,
          filesize: t.filesize
        }))
      })) as Track[])
    );

    date.setUTCMilliseconds(date.getUTCMilliseconds() - DAY_MS);
  }
  return res;
};

const bytesLeft = (Cookie: string) =>
  axios
    .get("https://srv.pickmyrec.com/a/ms/app?v=1.6.389", {
      headers: {
        Accept: "application/json",
        Cookie
      }
    })
    .then((response: any) => {
      const ret: { [sectionName: string]: number } = {};
      response.data.sections.list.forEach((l: any) => {
        ret[l.nm] = l.balance.bytesleft;
      });
      return ret;
    });

// const isSelected = (c: string) => selected.includes(c.toUpperCase());

// const filteredReleases = (releases: any) =>
//   releases.filter(
//     ({ tracks }) =>
//       tracks.find(({ category }) => isSelected(category)) !== undefined
//   );

const main = async () => {
  Cookie = `SESS=${await login(USER_LOGIN, USER_PASS)}`;
  console.log(Cookie);
  await ensureDir("./downloads/");

  // const selected = categories
  //   .filter(c => c.selected)
  //   .map(c => c.nm.toUpperCase());

  // console.log(`Selected categories: ${selected.map(s => `"${s}"`).join(" ")}`);
  const date = new Date();
  date.setUTCMilliseconds(date.getUTCMilliseconds() - 2 * DAY_MS);

  const bytesleft = await bytesLeft(Cookie);

  // ----------------------DOWNLOAD FILES---------------------------------//

  const categories: Category[] = await readJson("./categories.json");
  const list_releases = await releases(date, bytesleft["Releases"], categories);

  const queue = downloadQueue(list_releases.map(x => x.id), 2, (id, m) => {
    console.debug("message from " + id, m);
  });

  await queue;

  console.log("-------------------------------------");

  const list_scene = await scene(date, 1);

  console.log(list_scene);

  const queue_scene = downloadQueue(
    list_scene.slice(0, 0).map(x => x.id),
    2,
    (id, m) => {
      console.debug("message from " + id, m);
    }
  );

  await queue_scene;

  // Releases
  // Scene
  // Charts
  // Promo
  // Packs
};

main();
