import express from "express";
import { Service } from "..";

const alert = new Service();
const app = express();
const port = 3001;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("/webhook/datadog/monitor/reboot", async ({ body }, res) => {
  if (!body.name) {
    return res.sendStatus(404);
  }
  const { name } = body;
  try {
    const info = await alert.rebootNode(name);
    return res.json({ done: true, info });
  } catch (error) {
    return res.sendStatus(500);
  }
});
app.listen(port, () => {
  console.log(`Webhook api listening at http://localhost:${port}`);
});
