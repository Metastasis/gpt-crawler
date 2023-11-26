import { Page } from "playwright";

type Config = {
  /** URL to start the crawl */
  url: string;
  /** Pattern to match against for links on a page to subsequently crawl */
  match: string;
  /** Selector to grab the inner text from */
  selector: string;
  /** Don't crawl more than this many pages */
  maxPagesToCrawl: number;
  /** File name for the finished data */
  outputFileName: string;
  /** Optional cookie to be set. E.g. for Cookie Consent */
  cookie?: {name: string; value: string}
  /** Optional function to run for each page found */
  onVisitPage?: (options: {
    page: Page;
    pushData: (data: any) => Promise<void>;
  }) => Promise<void>;
  /** Optional timeout for waiting for a selector to appear */
  waitForSelectorTimeout?: number;
  /** Menu categories to exclude from scraping */
  excludedCategories?: string;
};

export const config: Config = {
  url: "https://www.wildberries.ru",
  match: "https://www.wildberries.ru/catalog/**",
  selector: `.product-card`,
  excludedCategories: '(пятница|новый.год|акции|цифровые.товары|путешествия|сделано.в.москве|premium|премиум|спорт)',
  maxPagesToCrawl: 50,
  outputFileName: "output.json",
  waitForSelectorTimeout: 8000
};
