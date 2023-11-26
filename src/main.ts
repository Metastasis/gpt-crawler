// For more information, see https://crawlee.dev/
import { PlaywrightCrawler } from "crawlee";
import { readFile, writeFile } from "fs/promises";
import { glob } from "glob";
import { config } from "../config.js";
import {router} from './routes';


if (process.env.NO_CRAWL !== "true") {
  // PlaywrightCrawler crawls the web using a headless
  // browser controlled by the Playwright library.
  const crawler = new PlaywrightCrawler({
    // Uncomment this option to see the browser window.
    // headless: false,
    // Comment this option to scrape the full website.
    maxRequestsPerCrawl: config.maxPagesToCrawl,
    requestHandler: router,
  });

  // Add first URL to the queue and start the crawl.
  await crawler.run([config.url]);
}

const jsonFiles = await glob("storage/datasets/default/*.json", {
  absolute: true,
});

const results = [];
for (const file of jsonFiles) {
  const data = JSON.parse(await readFile(file, "utf-8"));
  results.push(data);
}

await writeFile(config.outputFileName, JSON.stringify(results, null, 2));
