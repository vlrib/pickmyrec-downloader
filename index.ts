import axios from "axios";
import { ensureDir } from "fs-extra";
import { fork } from "child_process";
import { parse } from "content-disposition";

const DAY_MS = 24 * 60 * 60 * 1000;
const Cookie = "SESS=737b34c8f9e377004e51da4555660c7715d19a";

const downloadRelease = (id: number) =>
  new Promise<Record<string, string>>((resolve, reject) => {
    console.log(`Downloading ${id}`);
    const cp = fork("./worker.js", [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"]
    });

    cp.stdout!.on("data", chunk => console.log(`cp-out: ${chunk.toString()}`));
    cp.stderr!.on("data", chunk => console.log(`cp-err: ${chunk.toString()}`));

    cp.send({ id, Cookie });
    cp.once("message", resolve);
    cp.once("error", reject);
  });

const main = async () => {
  await ensureDir("./downloads/");
  const date = new Date();
  date.setUTCMilliseconds(date.getUTCMilliseconds() - 2 * DAY_MS);
  console.log(date);
  const tasks = [] as Promise<string>[];
  for (let mc = 0; mc < 50; ) {
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
    const releases = data.releases.map(({ id }: any) => Number(id)) as number[];
    mc += releases.length;

    tasks.push(
      ...releases.map(id =>
        downloadRelease(id).then(hdr => {
          const {
            parameters: { filename }
          } = parse(hdr["content-disposition"]);
          console.log(`Downloaded and extracted ${filename}`);
          return filename as string;
        })
      )
    );

    date.setUTCMilliseconds(date.getUTCMilliseconds() - DAY_MS);
  }

  const downloaded = await Promise.all(tasks);
  console.log(`Finished:\n${downloaded.join("\n")}`);
};

main();
