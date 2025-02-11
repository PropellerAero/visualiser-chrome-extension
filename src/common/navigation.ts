import { NotPropellerWebsiteError } from "../popup/scripts/errors";
import { useEffect, useState } from "react";

export enum Environment {
  Dev,
  Staging,
  Production,
}

export const ENVIRONMENT_LABLES: Record<Environment, string> = {
  [Environment.Dev]: "Development",
  [Environment.Staging]: "Staging",
  [Environment.Production]: "Production",
};
export const ENVIRONMENT_HOSTS: Record<Environment, string> = {
  [Environment.Dev]: "api-dev.prpeller.com",
  [Environment.Staging]: "api-staging.prpeller.com",
  [Environment.Production]: "prpellr.com",
};

export function getTabEnvironment(tab: chrome.tabs.Tab): Environment {
  const url = tab.url;
  if (url == null)
    throw new NotPropellerWebsiteError("No URL found for active tab");

  switch (true) {
    case /^https:\/\/.*\.api-staging.prpeller.com\/.*/.test(url):
      return Environment.Staging;
    case /^https:\/\/.*\.prpellr.com\/.*/.test(url):
      return Environment.Production;
    case /^https:\/\/.*\.api-dev.prpeller.com\/.*/.test(url):
      return Environment.Dev;
    default:
      throw new NotPropellerWebsiteError(`No matching URL for ${url}`);
  }
}
