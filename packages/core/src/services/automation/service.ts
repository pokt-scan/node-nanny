import { EC2 } from "aws-sdk";
import { exec } from "child_process";

import { Service as DiscordService } from "../discord";
import { ELoadBalancerStatus } from "../event/types";
import {
  NodesModel,
  IHost,
  INode,
  ChainsModel,
  HostsModel,
  LocationsModel,
} from "../../models";
import {
  IHostInput,
  IHostCsvInput,
  IHostUpdate,
  INodeInput,
  INodeCsvInput,
  INodeUpdate,
} from "./types";
import { Service as BaseService } from "../base-service/base-service";

export class Service extends BaseService {
  private ec2: EC2;

  constructor() {
    super();
    this.ec2 = new EC2({ region: "us-east-2" });
  }

  /* ----- CRUD Methods ----- */
  public async createHost(hostInput: IHostInput, restart = true): Promise<IHost> {
    const hostFields: IHostInput = {
      name: hostInput.name,
      location: hostInput.location,
      loadBalancer: hostInput.loadBalancer,
    };
    if (hostInput.fqdn) hostFields.fqdn = hostInput.fqdn;
    if (hostInput.ip) hostFields.ip = hostInput.ip;
    const host = await HostsModel.create(hostFields);
    if (restart) await this.restartMonitor();
    return host;
  }

  public async createHostsCSV(hosts: IHostCsvInput[]): Promise<IHost[]> {
    try {
      const createdHosts: IHost[] = [];
      for await (let hostInput of hosts) {
        const hostInputObj: IHostInput = {
          name: hostInput.name,
          loadBalancer: Boolean(hostInput.loadBalancer),
          location: (await LocationsModel.findOne({ name: hostInput.location }))._id,
        };
        if (hostInput.ip) hostInputObj.ip = hostInput.ip;
        if (hostInput.fqdn) hostInputObj.fqdn = hostInput.fqdn;

        const host = await HostsModel.create(hostInputObj);
        createdHosts.push(host);
      }

      await this.restartMonitor();

      return createdHosts;
    } catch (error) {
      throw new Error(`Host CSV creation error: ${error}`);
    }
  }

  public async createNode(nodeInput: INodeInput, restart = true): Promise<INode> {
    let id: string;
    const { https, ...rest } = nodeInput;
    const { fqdn, ip } = await HostsModel.findOne({ _id: nodeInput.host });

    if (https && !fqdn) {
      throw new Error(`Node cannot use https with a host that does not have a FQDN.`);
    }

    const url = `http${https ? "s" : ""}://${fqdn || ip}:${nodeInput.port}`;

    try {
      ({ id } = await NodesModel.create({ ...rest, url }));

      const node = await this.getNode(id);

      if (!nodeInput.frontend) await new DiscordService().addWebhookForNode(node);
      if (restart) await this.restartMonitor();

      return node;
    } catch (error) {
      await NodesModel.deleteOne({ _id: id });
      throw error;
    }
  }

  public async createNodesCSV(nodes: INodeCsvInput[]): Promise<INode[]> {
    try {
      const createdNodes: INode[] = [];
      for await (const nodeInput of nodes) {
        const nodeInputWithIds: INodeInput = {
          ...nodeInput,
          https: Boolean(nodeInput.https),
          chain: (await ChainsModel.findOne({ name: nodeInput.chain }))._id,
          host: (await HostsModel.findOne({ name: nodeInput.host }))._id,
          loadBalancers: (
            await HostsModel.find({ name: { $in: nodeInput.loadBalancers } })
          ).map(({ _id }) => _id),
        };

        const node = await this.createNode(nodeInputWithIds, false);
        createdNodes.push(node);
      }

      await this.restartMonitor();

      return createdNodes;
    } catch (error) {
      throw new Error(`Node CSV creation error: ${error}`);
    }
  }

  public async updateHost(update: IHostUpdate, restart = true): Promise<IHost> {
    const { id } = update;
    delete update.id;
    const sanitizedUpdate: any = {};
    Object.entries(update).forEach(([key, value]) => {
      if (value !== undefined) sanitizedUpdate[key] = value;
    });

    await HostsModel.updateOne({ _id: id }, { ...sanitizedUpdate });
    if (restart) await this.restartMonitor();

    return await HostsModel.findOne({ _id: id }).populate("location").exec();
  }

  public async updateNode(update: INodeUpdate, restart = true): Promise<INode> {
    const { id } = update;
    delete update.id;
    const sanitizedUpdate: any = {};
    Object.entries(update).forEach(([key, value]) => {
      if (value !== undefined) sanitizedUpdate[key] = value;
    });

    if (sanitizedUpdate.port) {
      const { url, port } = await NodesModel.findOne({ _id: id });
      sanitizedUpdate.url = url.replace(String(port), String(sanitizedUpdate.port));
    }

    await NodesModel.updateOne({ _id: id }, { ...sanitizedUpdate });
    if (restart) await this.restartMonitor();

    return await this.getNode(id);
  }

  public async deleteHost(id: string, restart = true): Promise<IHost> {
    const host = await HostsModel.findOne({ _id: id }).populate("location").exec();

    await HostsModel.deleteOne({ _id: id });
    if (restart) await this.restartMonitor();

    return host;
  }

  public async deleteNode(id: string, restart = true): Promise<INode> {
    const node = await this.getNode(id);

    await NodesModel.deleteOne({ _id: id });
    if (restart) await this.restartMonitor();

    return node;
  }

  /* ----- Rotation Methods ----- */
  async addToRotation(id: string): Promise<boolean> {
    const { backend, server, host, chain, loadBalancers } = await this.getNode(id);

    await this.enableServer({ destination: backend, server, loadBalancers });

    return await this.alert.sendInfo({
      title: "[Manually Added to Rotation] - Success",
      message: `${host.name}/${chain.name}/${server} added to ${backend}.`,
      chain: chain.name,
      location: host.name,
    });
  }

  async removeFromRotation(id: string): Promise<boolean> {
    const { backend, server, host, chain, loadBalancers } = await this.getNode(id);

    await this.disableServer({
      destination: backend,
      server,
      loadBalancers,
      manual: true,
    });

    return await this.alert.sendInfo({
      title: "[Manually Removed from Rotation] - Success",
      message: `${host.name}/${chain.name}/${server} removed from ${backend}.`,
      chain: chain.name,
      location: host.name,
    });
  }

  /* ----- Status Check Methods ----- */
  async getHaProxyStatus(id: string): Promise<-1 | 0 | 1> {
    const { backend, haProxy, server, loadBalancers } = await this.getNode(id);
    if (haProxy === false) {
      return -1;
    }

    const result = await this.getServerStatus({
      destination: backend,
      server,
      loadBalancers,
    });

    if (result === ELoadBalancerStatus.ONLINE) {
      return 0;
    }
    return 1;
  }

  async muteMonitor(id: string): Promise<INode> {
    await NodesModel.updateOne({ _id: id }, { muted: true }).exec();
    await this.restartMonitor();
    return await this.getNode(id);
  }

  async unmuteMonitor(id: string): Promise<INode> {
    await NodesModel.updateOne({ _id: id }, { muted: false });
    await this.restartMonitor();
    return await this.getNode(id);
  }

  private async restartMonitor(): Promise<boolean> {
    try {
      return await new Promise((resolve, reject) => {
        exec("pm2 restart monitor", (error, stdout) => {
          if (error) reject(`error: ${error.message}`);
          resolve(!!stdout);
        });
      });
    } catch (error) {
      console.log("Cannot restart monitor, monitor not running.");
    }
  }
}
