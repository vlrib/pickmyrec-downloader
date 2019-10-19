import axios from "axios";
import { ensureDir } from "fs-extra";
import { Extract } from "unzip";
import { get } from "https";

const DAY_MS = 24 * 60 * 60 * 1000;
const Cookie = "SESS=737b34c8f9e377004e51da4555660c7715d19a";

const urlDownloadRelease = (id: number) =>
  `https://srv.pickmyrec.com/dwnld/release/${id}.zip`;

const downloadRelease = async (id: number) =>
  get(
    urlDownloadRelease(id),
    {
      headers: {
        Cookie,
        ["Host"]: "srv.pickmyrec.com",
        ["Connection"]: "keep-alive",
        ["Upgrade-Insecure-Requests"]: "1",
        ["User-Agent"]:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36",
        ["Sec-Fetch-Mode"]: "nested-navigate",
        ["Accept"]:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
        ["Sec-Fetch-Site"]: "same-origin",
        ["Referer"]: "https://srv.pickmyrec.com/",
        ["Accept-Encoding"]: "gzip, deflate, br",
        ["Accept-Language"]: "en-US,en;q=0.9"
      }
    },
    res => {
      try {
        res.pipe(Extract({ path: "./downloads" }));
      } catch (e) {
        console.log(`Error downloading release ${id}`);
      }
    }
  );

const main = async () => {
  await ensureDir("./downloads/");
  const date = new Date();
  date.setUTCMilliseconds(date.getUTCMilliseconds() - 2 * DAY_MS);
  console.log(date);
  for (let mc = 0; mc < 100; ) {
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

    await Promise.all(releases.map(id => downloadRelease(id)));
    console.log(`Downloaded ${mc}/100`);

    date.setUTCMilliseconds(date.getUTCMilliseconds() - DAY_MS);
  }
};

main();
