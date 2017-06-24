'use strict';

const fs = require('fs');
const path = require('path');
const pigeon = require('@mapbox/price-pigeon/lib/lib');

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

const regionalPrices = (priceData) => {
  return Object.keys(priceData.products).reduce((byType, key) => {
    const product = priceData.products[key];

    if (product.productFamily !== 'Compute Instance' || product.attributes.operatingSystem !== 'Linux')
      return byType;

    if (!regions[product.attributes.location])
      return byType;

    if (!byType[product.attributes.instanceType])
      byType[product.attributes.instanceType] = { price: {} };

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
    const gbMemory = Number(memoryString.split(' ')[0]);
    const memoryUnits = gbMemory * 1024;

    const storageString = product.attributes.storage;
    let gbStorage = 0;
    const isSSD = /SSD$/.test(storageString);
    if (storageString !== 'EBS only') {
      gbStorage = Number(storageString.split(' x ')[0]) *
                  Number(storageString.split(' x ')[1].replace(/ SSD| HDD/, ''));
    }

    Object.assign(byType[product.attributes.instanceType], {
      cpus, gbMemory, gbStorage, isSSD, cpuUnits, memoryUnits
    });

    const price = parseFloat(priceString);
    const previous = byType[product.attributes.instanceType]
      .price[regions[[product.attributes.location]]] || 0;

    byType[product.attributes.instanceType]
      .price[regions[[product.attributes.location]]] = Math.max(previous, price);

    return byType;
  }, {});
};

const prices = () => {
  return new Promise((resolve, reject) => {
    pigeon.getResponse(null, null, (err, data) => {
      if (err) return reject(err);
      resolve(regionalPrices(JSON.parse(data)));
    });
  });
};

prices()
  .then((data) => Object.keys(data).forEach((type) => {
    fs.writeFile(path.join(__dirname, type), JSON.stringify(data[type], null, 2));
  }));
