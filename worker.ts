import { Extract } from "unzip";
import { get } from "https";
import { IncomingMessage } from "http";

const urlDownloadRelease = (id: number) =>
  `https://srv.pickmyrec.com/dwnld/release/${id}.zip`;

const downloadRelease = (
  id: number,
  Cookie: string,
  callback: (headers: IncomingMessage["headers"]) => any
) =>
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
    (res: IncomingMessage) => {
      res.on("end", () => callback(res.headers));
      res.pipe(Extract({ path: "./downloads" }));
    }
  );

process.once("message", ({ id, Cookie }) => {
  downloadRelease(id, Cookie, headers => {
    process.send!(headers);
  });
});
