'use strict';

const fs = require('fs');
const path = require('path');
const got = require('got');

const regions = {
  'US East (N. Virginia)': 'us-east-1',
  'US East (Ohio)': 'us-east-2',
  'US West (N. California)': 'us-west-1',
  'US West (Oregon)': 'us-west-2',
  'Canada (Central)': 'ca-central-1',
  'EU (Ireland)': 'eu-west-1',
  'EU (Frankfurt)': 'eu-central-1',
  'EU (London)': 'eu-west-2',
  'Asia Pacific (Tokyo)': 'ap-northeast-1',
  'Asia Pacific (Seoul)': 'ap-northeast-2',
  'Asia Pacific (Singapore)': 'ap-southeast-1',
  'Asia Pacific (Sydney)': 'ap-southeast-2',
  'Asia Pacific (Mumbai)': 'ap-south-1',
  'South America (São Paulo)': 'sa-east-1'
};

const i3shim = {
  'i3.large': 486.4,
  'i3.xlarge': 972.8,
  'i3.2xlarge': 1945.6,
  'i3.4xlarge': 3891.2,
  'i3.8xlarge': 7782.4,
  'i3.16xlarge': 15564.8
};

const extractData = (priceData) => {
  return Object.keys(priceData.products).reduce((byType, key) => {
    const product = priceData.products[key];

    if (product.productFamily !== 'Compute Instance' || product.attributes.operatingSystem !== 'Linux')
      return byType;

    const region = regions[product.attributes.location];
    if (!region) return byType;

    const type = product.attributes.instanceType;
    if (!byType[type])
      byType[type] = { price: {} };

    const terms = priceData.terms.OnDemand[product.sku];
    const skuOTC = Object.keys(terms)[0];
    const skuRC = Object.keys(terms[skuOTC].priceDimensions)[0];
    const priceString = terms[skuOTC].priceDimensions[skuRC].pricePerUnit.USD;
    const description = terms[skuOTC].priceDimensions[skuRC].description;

    if (!/On Demand/.test(description))
      return byType;

    const cpus = Number(product.attributes.vcpu);
    const cpuUnits = cpus * 1024;

    const memoryString = product.attributes.memory;
    const memory = Number(memoryString.split(' ')[0].replace(',', ''));
    const memoryUnits = memory * 1024;

    const storageString = product.attributes.storage;
    let storage = 0;
    if (storageString !== 'EBS only') {
      storage = Number(storageString.split(' x ')[0]) *
                Number(storageString.split(' x ')[1]
                  .replace(/ SSD| HDD|,/g, ''));
    }
    if (/^i3\./.test(type)) storage = i3shim[type];

    let SSD = /SSD$/.test(storageString);
    if (/^x1\./.test(type)) SSD = true;
    if (/^i3\./.test(type)) SSD = true;

    Object.assign(byType[type], {
      cpus, memory, storage, SSD, cpuUnits, memoryUnits
    });

    const price = parseFloat(priceString);
    const previous = byType[type].price[region] || 0;
    byType[type].price[region] = Math.max(previous, price);

    return byType;
  }, {});
};

got.get('https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/index.json')
  .then((response) => JSON.parse(response.body))
  .then((data) => extractData(data))
  .then((data) => Object.keys(data).forEach((type) => {
    fs.writeFile(path.join(__dirname, `${type}.json`), JSON.stringify(data[type], null, 2));
  }));
