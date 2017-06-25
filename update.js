'use strict';

const fs = require('fs');
const path = require('path');
const got = require('got');
const AWS = require('aws-sdk');
const ss = require('simple-statistics');
const Queue = require('p-queue');
const Spinner = require('cli-spinner').Spinner;
Spinner.setDefaultSpinnerString('⠄⠆⠇⠋⠙⠸⠰⠠⠰⠸⠙⠋⠇⠆');

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
  'South America (São Paulo)': 'sa-east-1',
  'South America (Sao Paulo)': 'sa-east-1',
  'AWS GovCloud (US)': 'us-gov-west-1'
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
  const data = Object.keys(priceData.products).reduce((byType, key) => {
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

    byType[type] = Object.assign({
      type, cpus, memory, storage, SSD, cpuUnits, memoryUnits
    }, byType[type]);

    const price = parseFloat(priceString);
    const previous = byType[type].price[region] || 0;
    byType[type].price[region] = Math.max(previous, price);

    return byType;
  }, {});

  const sorted = {};

  Object.keys(data)
    .sort()
    .forEach((type) => {
      sorted[type] = data[type];
      sorted[type].price = Object.keys(data[type].price)
        .sort()
        .reduce((price, region) => {
          price[region] = data[type].price[region];
          return price;
        }, {});
    });

  return sorted;
};

const spot = (type, region, onDemandPrice) => {
  const ec2 = new AWS.EC2({ region });

  return new Promise((resolve, reject) => {
    const params = {
      InstanceTypes: [type],
      StartTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      Filters: [
        {
          Name: 'product-description',
          Values: ['Linux/UNIX']
        }
      ]
    };

    const reduce = (data) => {
      const azData = data.reduce((azData, point) => {
        const az = point.AvailabilityZone.split('-').pop();
        azData[az] = azData[az] || [];
        azData[az].push(Number(point.SpotPrice));
        azData.overall.push(Number(point.SpotPrice));
        return azData;
      }, { overall: [] });

      const azStats = Object.keys(azData).reduce((azStats, az) => {
        azStats[az] = azData[az].length ? {
          min: ss.min(azData[az]),
          max: ss.max(azData[az]),
          mean: Number(ss.mean(azData[az]).toFixed(6)),
          variance: Number(ss.variance(azData[az]).toFixed(6)),
          over: azData[az].filter((price) => price >= onDemandPrice).length,
          count: azData[az].length
        } : {
          min: null,
          max: null,
          mean: null,
          variance: null,
          over: null,
          count: 0
        };
        return azStats;
      }, { type, region });

      return azStats;
    };

    let priceData = [];

    ec2.describeSpotPriceHistory(params).eachPage((err, data, done) => {
      if (err) return reject(err);
      if (!data) return resolve(reduce(priceData));
      priceData = priceData.concat(data.SpotPriceHistory);
      done();
    });
  });
};

const addSpotData = (data) => {
  const spinner = new Spinner();
  const queue = new Queue({ concurrency: 20 });
  const requests = [];
  let completed = 0;
  let total = 0;

  Object.keys(data).forEach((type) => {
    Object.keys((data[type].price)).forEach((region) => {
      if (region === 'us-gov-west-1') return;

      requests.push(
        queue.add(
          () => spot(type, region, data[type].price[region]).then((data) => {
            completed++;
            spinner.setSpinnerTitle(`Analyzing spot history: ${(100 * (completed / total)).toFixed(2)}% complete`);
            return data;
          })
        )
      );
    });
  });

  total = requests.length;
  spinner.setSpinnerTitle(`Analyzing spot history: ${(100 * (completed / total)).toFixed(2)}% complete`);
  spinner.start();

  return Promise.all(requests).then((results) => {
    results.forEach((spot) => {
      const type = spot.type;
      const region = spot.region;
      data[type].spot = data[type].spot || {};
      data[type].spot[region] = JSON.parse(JSON.stringify(spot));
      delete data[type].spot[region].type;
      delete data[type].spot[region].region;
    });

    spinner.stop(true);
    return data;
  });
};

Promise.resolve()
  .then(() => {
    const spinner = new Spinner('Fetching on-demand price data...');
    spinner.start();

    return got.get('https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/index.json')
      .then((response) => JSON.parse(response.body))
      .then((data) => extractData(data))
      .then((data) => {
        spinner.stop(true);
        return data;
      });
  })
  .then((data) => addSpotData(data))
  .then((data) => {
    const families = {};

    fs.writeFile(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2));

    Object.keys(data).forEach((type) => {
      fs.writeFile(path.join(__dirname, `${type}.json`), JSON.stringify(data[type], null, 2));
      const family = type.split('.')[0];
      families[family] = families[family] || [];
      families[family].push(data[type]);
    });

    Object.keys(families).forEach((family) => {
      const data = families[family]
        .sort((a, b) => {
          if (a.cpus > b.cpus) return 1;
          if (a.cpus < b.cpus) return -1;
          return 0;
        });
      fs.writeFile(path.join(__dirname, `${family}.json`), JSON.stringify(data, null, 2));
    });
  })
  .catch((err) => console.error(err.stack));
