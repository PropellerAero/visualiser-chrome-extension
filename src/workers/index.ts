import "./messaging";
import "./injection";

chrome.runtime.onInstalled.addListener(() => {
  console.log("started worker");
});
