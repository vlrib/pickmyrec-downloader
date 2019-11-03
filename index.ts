import axios from "axios";
import { readJson, ensureDir } from "fs-extra";
import { fork } from "child_process";

const { login: USER_LOGIN, password: USER_PASS } = require("./details.json");

const matchThreshold = 0.3;

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

interface Release {
  id: number;
  tracks: Track[];
  totalsize: number;
  matchPercentile: number;
}

interface Track {
  category: string;
  filesize: number;
}

const getList = async (
  section: string,
  date: Date,
  bytes: number,
  categories: any
) => {
  const res: Release[] = [];
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
      `https://srv.pickmyrec.com/a/ms/section/${section}/media?date=${param}&mp3prefered=false&popular_order=true`,
      {
        headers: {
          Accept: "application/json",
          Cookie
        }
      }
    );
    res.push(
      ...(data.releases
        .filter((r: any) => !r.downloaded)
        .map((r: any) => ({
          id: r.id as number,
          tracks: r.tracks.map((t: any) => ({
            category: t.category_nm
          })) as Track[],
          matchPercentile: (r.tracks.filter((t: any) =>
            selectedCategories.some((s: any) => s.nm == t.category_nm)
          ).length / r.tracks.length) as number
        })) as Release[])
    );

    date.setUTCMilliseconds(date.getUTCMilliseconds() - DAY_MS);
  }

  return res.filter(r => r.matchPercentile >= matchThreshold);
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
        ret[l.nm.toUpperCase()] = l.balance.bytesleft;
      });
      return ret;
    });

const main = async () => {
  Cookie = `SESS=${await login(USER_LOGIN, USER_PASS)}`;
  console.log(Cookie);
  await ensureDir("./downloads/");

  const date = new Date();
  date.setUTCMilliseconds(date.getUTCMilliseconds() - 2 * DAY_MS);

  const bytesleft = await bytesLeft(Cookie);

  // -------------------------DOWNLOAD RELEASE FILES---------------------------------//

  const releaseCategories: Category[] = await readJson(
    "categories/release-categories.json"
  );
  console.log(
    `Selected categories: ${releaseCategories
      .filter((r: Category) => r.selected)
      .map(s => `"${s.nm}"`)
      .join(" ")}`
  );

  const list_releases = await getList(
    "beatport",
    date,
    bytesleft["RELEASES"],
    releaseCategories
  );
  console.log("Downloading from Releases...");

  const queue_releases = downloadQueue(
    list_releases.map(x => x.id),
    2,
    (id, m) => {
      console.debug("message from " + id, m);
    }
  );

  await queue_releases;
  console.log("-------------------------------------");

  // -------------------------DOWNLOAD SCENE FILES---------------------------------//
  const sceneCategories: Category[] = await readJson("./scene-categories.json");
  console.log(
    `Selected categories: ${sceneCategories
      .filter((r: Category) => r.selected)
      .map(s => `"${s.nm}"`)
      .join(" ")}`
  );

  const list_scene = await getList(
    "scene",
    date,
    bytesleft["SCENE"],
    sceneCategories
  );
  console.log("Downloading from scenes...");

  const queue_scene = downloadQueue(list_scene.map(x => x.id), 2, (id, m) => {
    console.debug("message from " + id, m);
  });

  await queue_scene;
  console.log("-------------------------------------");

  // -------------------------DOWNLOAD CHARTS FILES---------------------------------//
  const chartsCategories: Category[] = await readJson(
    "./charts-categories.json"
  );
  console.log(
    `Selected categories: ${chartsCategories
      .filter((r: Category) => r.selected)
      .map(s => `"${s.nm}"`)
      .join(" ")}`
  );

  const list_charts = await getList(
    "charts",
    date,
    bytesleft["CHARTS"],
    chartsCategories
  );
  console.log("Downloading from charts...");

  const queue_charts = downloadQueue(list_charts.map(x => x.id), 2, (id, m) => {
    console.debug("message from " + id, m);
  });

  await queue_charts;
  console.log("-------------------------------------");

  // -------------------------DOWNLOAD PROMO FILES---------------------------------//
  const promoCategories: Category[] = await readJson("./promo-categories.json");
  console.log(
    `Selected categories: ${promoCategories
      .filter((r: Category) => r.selected)
      .map(s => `"${s.nm}"`)
      .join(" ")}`
  );

  const list_promo = await getList(
    "promo",
    date,
    bytesleft["PROMO"],
    promoCategories
  );
  console.log("Downloading from promo...");

  const queue_promo = downloadQueue(list_promo.map(x => x.id), 2, (id, m) => {
    console.debug("message from " + id, m);
  });

  await queue_promo;
  console.log("-------------------------------------");

  // Releases
  // Scene
  // Charts
  // Promo
  // Packs
};

main();
