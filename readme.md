# ec2s

Simple, quick access to price and capacity information for each [AWS EC2 instance type](https://aws.amazon.com/ec2/instance-types/).

```
https://rclark.github.io/ec2s/${instance-type}.json
```

For example, data for [x1.16xlarge instances is here](https://rclark.github.io/ec2s/x1.16xlarge.json).

You can also look at an entire family at once.

```
https://rclark.github.io/ec2s/${family}.json
```

For example, data for [all the r3 instance types is here](https://rclark.github.io/ec2s/r3.json).

---

Update pricing data by running `npm run update` and committing the result to this repo.
