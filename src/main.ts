// For more information, see https://crawlee.dev/
import { PlaywrightCrawler } from "crawlee";
import { readFile, writeFile } from "fs/promises";
import { glob } from "glob";
import { config } from "../config.js";
import { Page } from "playwright";


/*
Что парсим?
- Количество карточек
- Компания или бренд
- Цена
- Оценка товара
- Количество оценок товара
* */
type WildberriesProduct = {
  title: string,
  url: string,
  price: string,
  rating: string,
  ratingCount: string,
  company: string,
};
type WildberriesCrawlerResult = {
  // products: WildberriesProduct[],
  total: number,
  // top category, e.g. "Женщинам"
  category: string,
  // subcategory, e.g. "Блузки и рубашки"
  subcategory: string,
  // goods type, e.g. "Блузка-боди"
  goodsCategory: string,
};

const wildberriesSelectors = {
  productsTotal: "span.goods-count",
  breadcrumbs: "ul.breadcrumbs__list",
  categoryFilters: ".dropdown-filter",
  categoryFilterOpened: ".dropdown-filter .selected"
} as const;

async function getPageHtml(page: Page): Promise<WildberriesCrawlerResult> {
  const productsTotal = await page.locator(wildberriesSelectors.productsTotal).innerText();
  // const total = parseInt(productsTotal, 10);
  const breadcrumbsRaw = await page.locator(wildberriesSelectors.breadcrumbs).innerText();
  const breadcrumbs = breadcrumbsRaw.split("\n").map((item) => item.trim().toLowerCase()).filter((item) => {
    return item.length > 0 && item !== "главная";
  });
  const [category, subcategory] = breadcrumbs;
  const categoryFilters = await page.locator(wildberriesSelectors.categoryFilters).filter({hasText: 'Категория'});
  const categoryButton = await categoryFilters.locator('button');
  await categoryButton.click();
  const categoryFilterOpened = await page.locator(wildberriesSelectors.categoryFilterOpened).last().textContent() || '';
  const categoryWithTotal = categoryFilterOpened.toLowerCase().trim();
  const goodsCategory = categoryWithTotal.replace(/[^а-яА-Я\-]/g, '');
  const total = parseInt(categoryWithTotal.replace(/[^\d]/g, ''), 10)
  return {
    total,
    category,
    subcategory,
    goodsCategory
  };
}

if (process.env.NO_CRAWL !== "true") {
  // PlaywrightCrawler crawls the web using a headless
  // browser controlled by the Playwright library.
  const crawler = new PlaywrightCrawler({
    // Use the requestHandler to process each of the crawled pages.
    async requestHandler({ request, page, enqueueLinks, log, pushData }) {

      if (config.cookie) {
        // Set the cookie for the specific URL
        const cookie = {
          name: config.cookie.name,
          value: config.cookie.value,
          url: request.loadedUrl,
        };
        await page.context().addCookies([cookie]);
      }

      const title = await page.title();
      log.info(`Crawling ${request.loadedUrl}...`);

      await page.waitForSelector(config.selector, {
        timeout: config.waitForSelectorTimeout ?? 1000,
      });

      const data: WildberriesCrawlerResult = await getPageHtml(page);

      // Save results as JSON to ./storage/datasets/default
      await pushData({ title, url: request.loadedUrl, data });

      if (config.onVisitPage) {
        await config.onVisitPage({ page, pushData });
      }

      // Extract links from the current page
      // and add them to the crawling queue.
      await enqueueLinks({
        globs: [config.match],
      });
    },
    // Comment this option to scrape the full website.
    maxRequestsPerCrawl: config.maxPagesToCrawl,
    // Uncomment this option to see the browser window.
    // headless: false,
  });

  // Add first URL to the queue and start the crawl.
  await crawler.run([config.url], {

  });
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
