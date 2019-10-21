import { createWriteStream } from "fs-extra";
import { parse } from "content-disposition";
import axios from "axios";

const httpAdapter = require("axios/lib/adapters/http");

const urlDownloadRelease = (id: number) =>
  `https://srv.pickmyrec.com/dwnld/release/${id}.zip`;

/* SENT MESSAGES: 
{
  type: "info",
  data: {
    filename,
    size
  }
}

{
  type: "progress",
  data: progress / size
}

{
  type: "error",
  data: (e || "").toString()
}

{
  type: "end",
  data: {
    id,
    filename,
    path,
    size
  }
}
*/

const downloadRelease = async (id: number, Cookie: string) =>
  new Promise(async (resolve, reject) => {
    const res = await axios.get(urlDownloadRelease(id), {
      responseType: "stream",
      adapter: httpAdapter,
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
    });

    const { data: stream, headers } = res;

    const {
      parameters: { filename }
    } = parse(headers["content-disposition"]);

    const size = Number(headers["content-length"]);
    let progress = 0;

    process.send!({
      type: "info",
      data: {
        filename,
        size
      }
    });

    const path = `./downloads/${filename}`;
    const output = createWriteStream(path);

    stream.on("data", (chunk: Buffer) => {
      progress += chunk.length;
      output.write(chunk);
      process.send!({
        type: "progress",
        data: progress / size
      });
    });

    stream.on("error", (e: any) => {
      output.end();
      reject(e);
      process.send!({
        type: "error",
        data: (e || "").toString()
      });
    });

    stream.on("end", () => {
      output.end();
      const data = {
        id,
        filename,
        path,
        size
      };
      process.send!({
        type: "end",
        data
      });
      resolve(data);
    });
  });

process.on("message", ({ type, data }) => {
  switch (type) {
    case "kill":
      process.exit(0);
      break;
    case "download":
      downloadRelease(data.id, data.Cookie);
      break;
  }
});
