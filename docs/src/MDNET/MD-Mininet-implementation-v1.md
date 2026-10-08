# MD-Mininet 第一版实施方案

日期：2026-10-02。状态：设计方案，未执行部署与性能测量。

## 1. 已确定的需求与设计基线

用户已确定：使用 Docker；第一版包含两个 Mininet 网络，每个约 10–20 个节点；每个模拟主机和交换机分别运行在 Docker 容器中；一个中央 SDN 控制器管理两个网络；动态信道和动态拓扑暂不实现，但保留之前讨论的模型、拓扑、目录及接口结构；不强制基于 DistriNet。

本方案建议：使用一台原生 Linux 主机上的 Docker Engine。Windows 保留为编辑、终端及查看结果的入口。两个网络由两个独立 Worker 管理实例负责，节点容器由同一台机器的 Docker Engine 创建。Worker 指管理本地网络分区的程序，不等同于物理机器或控制域。

优先直接在 Linux 上运行两个 Worker/Mininet Python 进程，节点保持容器化；Worker 自身容器化作为随后验证的部署选项。用户要求的是每个模拟节点容器化，这并不要求把管理程序也立即套进容器。

后续把 Worker B 与其节点迁移到第二台 Linux 主机，仍使用同一控制器与拓扑描述。单机阶段验证的是网络分区、统一控制和接口，不宣称已验证真实多机器性能。

## 2. Windows、WSL2 与原生 Linux 的选择

| 比较项 | Windows + Docker Desktop / WSL2 | 原生 Linux + Docker Engine |
| --- | --- | --- |
| 容器使用的内核 | WSL2 Linux 内核，Docker Desktop 在自己的 WSL 环境运行 | 当前 Linux 主机内核 |
| 访问宿主网络设备 | 存在 Windows、WSL 与 Docker 后端的边界 | 主机网络命名空间可直接管理 |
| OVS 内核数据通路 | 需要验证所用内核是否提供相应支持；容器安装软件不等于补齐内核功能 | 可检查并配置主机内核支持 |
| 主机网络模式 | Desktop 对主机的集成有 TCP/UDP 层面的限制，不能照搬原生 Linux 的二层假设 | 可共享 Linux 主机的网络命名空间 |
| 节点容器互联 | 可以尝试，但应在实际 Docker 后端中验证 | 建议采用的初始部署环境 |
| 实验结果解释 | 记录虚拟化、资源分配及 Windows 后台负载 | 记录主机负载及共享资源竞争 |

网络命名空间是 Linux 对网卡、路由表、网络协议栈等资源的隔离机制。Open vSwitch（OVS）是可由 SDN 控制器编程的软件交换机。内核数据通路是 OVS 在 Linux 内核里执行报文转发的部分。

上述建议依据官方架构约束作出，不代表已经测得 WSL2 的时延或吞吐更差。没有统一可套用的性能差值。也不能根据 Docker Desktop 的主机网络限制，推断容器之间完全不能进行二层通信。

若继续使用 Docker Desktop，先验证：实际容器内核的 OVS 支持、两个节点间虚拟链路、容器中的 OVS 转发、流量控制功能、VXLAN 端点互通。Linux 下的诊断应运行在真正承载容器和链路的环境中；仅在 WSL Ubuntu 中执行 docker CLI，不代表容器由 Ubuntu 内的 Docker Engine 承载。WSL2 可以配置自定义内核和模块，但不把维护自定义内核列为本项目第一版必需工作。

## 3. Docker 的部署层次

| 组件 | 第一版部署 | 职责 |
| --- | --- | --- |
| Docker Engine | Linux 主机上的一套引擎 | 创建和管理全部节点容器 |
| 实验编排器 | Linux Python 进程 | 读取配置，启动两组网络，汇总部署状态 |
| Worker A | 独立 Python/Mininet 进程 | 管理 A 组的 10–20 个节点 |
| Worker B | 独立 Python/Mininet 进程 | 管理 B 组的 10–20 个节点 |
| 中央 SDN 控制器 | 独立 Docker 容器 | 计算路径，通过 OpenFlow 安装转发规则 |
| 模拟主机 | 每节点一个 Docker 容器 | 运行 ping、TCP/UDP 业务和抓包工具 |
| 模拟交换机 | 每节点一个 Docker 容器 | 运行该节点自己的 OVS 服务和转发桥 |

OpenFlow 是控制器与交换机交换控制消息、安装转发规则的协议。

两个 Worker 也可以分别放进 Docker 容器，但推荐它们通过宿主机的 Docker API 管理同级节点容器。文件系统意义上不存在“Worker 容器里面包着所有节点容器”的要求。不要把这种方式与在两个 Worker 内各启动一个 Docker Engine 混为一谈。

Worker 容器化需要访问 Docker API，并具备操作目标节点网络命名空间的能力。使用宿主机进程命名空间的方案可通过目标容器 PID 定位网络命名空间；具体权限与命名空间组合应在原生 Linux 上先用最小样例验证。它提供程序依赖和生命周期封装，不提供独立 Linux 内核。网络操作还要防止两个 Worker 互相删除资源。

Containernet 是支持 Docker 模拟主机的 Mininet 分支，可以复用其主机接入与命令执行实现。但官方常见示例仍使用 OVSSwitch，不能直接假定每个交换机已容器化。满足本项目需要另外实现 DockerOVSSwitch 或等价交换机适配器，并验证一个容器一个 OVS 实例。最终是否复用 Containernet，以最小样例的兼容性和代码改动量判断，不把完整工具绑定进系统。

## 4. 节点与链路实现

### 4.1 主机节点

采用统一轻量镜像，包含 iproute2、ping、iperf3、tcpdump 等工具。业务接口由项目创建，配置固定 IP、MAC。主机不接入一个可以绕过模拟交换机的共享 Docker 业务网桥。第一版可使用无默认 Docker 网络的主机容器，通过 docker exec 执行管理命令。

### 4.2 交换机节点

每个交换机容器拥有独立网络命名空间、ovsdb-server 数据库服务、ovs-vswitchd 交换服务、数据库文件和控制套接字。容器内创建一个模拟交换机桥，配置唯一 DPID，并连接中央控制器。

DPID 是 OpenFlow 交换机标识。在同一个控制器管理范围中必须能唯一识别交换机。节点 IP、MAC 在第一版单地址空间内统一分配；这属于本实验的简化规则，不宣称所有现实网络都必须全局唯一。以后隔离不同网络租户或地址空间时，可以设计重复地址。

OVS 在 Linux 中使用共享的内核支持；每个容器不会获得自己的 Linux 内核。交换机数据库、控制套接字和业务接口应分别隔离，不能把同一套 /var/run/openvswitch 或数据库目录挂给全部交换机。

### 4.3 同机器链路

使用 veth，即两端相连的一对虚拟以太网接口。分别把两端放入对应节点的网络命名空间；交换机端加入该容器的 OVS 桥。同 Worker 和跨 Worker 的本机链路都由一个统一链路执行器操作，Worker 仅报告需求和所属节点，避免两端重复建链。

### 4.4 跨机器链路

保留 VXLAN 后端：VXLAN 把以太网报文封装在 UDP 中，使不同机器上的节点能够形成逻辑二层链路。每条逻辑跨机器链路登记独立的标识、隧道端点和 VNI（VXLAN 的网络标识）。明确逻辑链路到端点接口、OVS 端口的映射。

第一版主机尚在同一台 Linux 上时，业务互联先使用 veth 完成。另做一个同机不同网络命名空间间的 VXLAN 小样例，验证隧道代码、接口及封装后的最大报文尺寸；它仍不能替代真正跨机器验证。第二台 Linux 可用后再运行跨机样例。

管理网络负责控制器连接、Worker API 和隧道端点可达；业务网络负责模拟主机的报文路径。交换机管理接口不能加入业务 OVS 桥。隧道底层网络只能输送封装报文，不能直接接通模拟主机的业务地址。

## 5. 单个中央控制器与端到端路由

控制器第一版采用 Python 框架适配层，优先验证 OS-Ken 与所选 OVS、Python 版本的组合；固定通过验证的版本。OS-Ken 是由 Ryu 分支发展而来的 OpenFlow 框架。路由模块不直接绑定框架事件对象，便于以后更换框架或拆成多个控制器。

第一版使用静态拓扑配置作为预期拓扑，运行时读取交换机实际 OpenFlow 端口和连接状态进行核对。主机与交换机端口的对应关系由编排器登记。暂不把广播探测和逐对通信作为获取全局拓扑的前提。

初始路径策略采用按跳数的最短路径。算法输入是统一的交换机图和主机挂接信息，输出是经过的交换机及每一步输出端口；以后可用时延、带宽等参数替换权重。

准备流程：

1. 编排器校验配置和全局标识，启动两组节点。
2. 链路执行器创建链路，交换机接入中央控制器。
3. 汇总实际端口、交换机状态和主机挂接信息，核对全局拓扑。
4. 控制器为各目标主机计算反向最短路径树，向相关交换机安装按目标 IPv4 地址匹配的转发规则。
5. 第一版向主机配置静态邻居项，使它们已知对端 MAC；暂不在可能有环的拓扑中泛洪 ARP。ARP 是 IPv4 网络中查询 IP 对应 MAC 的协议。
6. 检查流表安装错误并等待各交换机的 Barrier 回复，再标记实验可运行。Barrier 是交换机确认已处理先前控制消息的机制，不表示多个交换机一起完成原子提交，也不证明路径上的数据报文已实测成功。
7. 使用指定的本域和跨网络主机对进行 ping、TCP/UDP 和抓包验证。

这种按目标安装的方式无需先对每对主机运行 pingall。初始规则数量大致与“交换机数 × 目标主机数”相关；它仍需随规模评估，不能声称没有扩展成本。第一版支持 IPv4 单播，不隐含已完成 IPv6、任意广播业务及租户地址重叠。

业务关闭或规则清除后，交换机应默认丢弃相应报文。禁止通过 OVS NORMAL 自动学习转发或共享 Docker 网桥，让测试在绕过控制器的情况下成功。负向验证包括：清除测试目标规则应中断通信，重新安装应恢复通信。

未来多个控制器的扩展保留 control/domain.py 与 control/cross_domain.py 接口；第一版不启动它们。runtime/coordinator.py 是实验部署编排器，负责启动节点和链路，不是用户此前讨论的跨域路由协调器。

## 6. 保留此前的模型和目录结构

保留此前讨论的 src/channel_mininet 包与以下路径。在现有结构上补充 Docker 节点及路由适配文件，不改动信道模型与拓扑模块的职责。

| 路径（相对于项目根目录） | 职责 | 第一版状态 |
| --- | --- | --- |
| src/channel_mininet/cli.py | 命令入口 | 实现 |
| src/channel_mininet/schema.py | 场景、节点、链路及 ChannelState 数据定义 | 实现基础定义 |
| src/channel_mininet/models/base.py | 信道模型统一接口 | 保留 |
| src/channel_mininet/models/propagation.py | 传播相关模型 | 保留 |
| src/channel_mininet/models/fading.py | 衰落模型 | 保留 |
| src/channel_mininet/models/interference.py | 干扰模型 | 保留 |
| src/channel_mininet/models/error_rate.py | 误码到网络效果的模型 | 保留 |
| src/channel_mininet/mobility/ | 节点位置与移动状态 | 保留 |
| src/channel_mininet/topology/builder.py | 静态拓扑构建 | 实现 |
| src/channel_mininet/topology/connectivity.py | 根据场景判断链路可达 | 保留动态接口 |
| src/channel_mininet/topology/placement.py | 节点到 Worker 的部署映射 | 第一版显式指定 |
| src/channel_mininet/runtime/coordinator.py | 实验启动、停止及状态汇总 | 实现 |
| src/channel_mininet/runtime/worker.py | 本地 Mininet 管理实例 | 实现 |
| src/channel_mininet/runtime/link_registry.py | 逻辑链路到实际接口的登记 | 实现 |
| src/channel_mininet/runtime/events.py | 拓扑和信道事件类型 | 定义，动态循环未启用 |
| src/channel_mininet/backends/mininet.py | Mininet 适配 | 实现 |
| src/channel_mininet/backends/docker.py | 容器创建、检查、执行和回收 | 新增实现 |
| src/channel_mininet/backends/docker_nodes.py | Docker 主机与 OVS 交换机类 | 新增实现 |
| src/channel_mininet/backends/tunnel.py | 跨机器隧道 | 保留，最小样例验证 |
| src/channel_mininet/backends/tc.py | Linux 链路参数执行 | 保留接口 |
| src/channel_mininet/control/sdn.py | 控制器框架适配 | 实现 |
| src/channel_mininet/control/routing.py | 全局路径计算 | 新增实现 |
| src/channel_mininet/control/flow_manager.py | 流表安装、确认、回收 | 新增实现 |
| src/channel_mininet/control/domain.py | 未来域控制器接口 | 新增预留 |
| src/channel_mininet/control/cross_domain.py | 未来跨域路由协调接口 | 新增预留 |
| src/channel_mininet/telemetry/ | 指标和抓包记录 | 基础实现 |
| configs/ | 拓扑、部署映射、镜像与参数配置 | 实现 |
| experiments/ | 可重复的实验入口 | 实现 |
| tests/ | 关键接口与集成验收 | 按实现需要补充 |
| docker/ | 主机、交换机、控制器及可选 Worker 镜像 | 新增 |

保留的集成流程是：场景状态 → 信道/连通性模型 → 有方向的链路参数和生效时间 → 本地链路执行器 → 节点网络接口。模型输出与执行器解耦。

ChannelState 建议明确包含 link_id、direction、available、bandwidth_mbps、delay_ms、jitter_ms、loss_pct、effective_time 和 version。字段单位、方向、版本与时间语义需要在 schema.py 里定义。

后续使用 Linux tc（流量控制工具）及 netem（时延、丢包等网络效果执行机制）作用于实际链路。每个方向只施加一次指定的传播损伤；不在隧道两端重复添加同一份时延。容器节点可能需要直接在目标命名空间配置 tc，不能假定所有自定义接口都能直接由 TCIntf.config 管理。第一版模型不运行，不生成看似真实但未经定义的卫星信道参数。

## 7. 同一台 Linux 上运行两个网络的约束

同机运行适合功能开发，但必须实施以下规则：

- 所有资源具有实验标识与 Worker 所属标签。接口使用长度受 Linux 约束的短名称，完整逻辑名称存登记表。
- Worker 停止时，只回收登记属于自己的容器、接口与配置；跨 Worker 链路由唯一链路执行器回收。不并行使用会清理全局状态的默认 mn -c 或其他全局删除命令。
- 每个交换机隔离 OVS 数据库、套接字和服务；记录实际端口号，不假定端口按创建顺序永久不变。
- 对单机资源竞争记录 CPU、内存、丢包和负载。两个网络共享 CPU、内存带宽、内核与部分 I/O，容器资源限额不能模拟独立物理主机的全部行为。
- 每次实验记录内核、Docker、Mininet/Containernet、OVS、控制器版本和镜像摘要，保留拓扑配置与映射文件。
- 测试停掉 Worker A 时，Worker B 节点应保留。涉及 A 的跨网络业务可以断开；不要求这类业务继续成功。

若要研究物理主机故障、控制通信的真实跨机开销、跨机吞吐及性能扩展，需要迁移到两个实际 Linux 主机。同一台机器启动更多容器不会自然产生这些独立故障和资源条件。

## 8. 实施阶段与验收

| 阶段 | 工作 | 验收条件 |
| --- | --- | --- |
| P0 环境能力 | 检查 Linux 内核、Docker、OVS 和网络操作权限 | 一个 OVS 容器可以创建桥、接入控制器并转发指定流量 |
| P1 最小节点样例 | 两个 Docker 主机、一个 Docker OVS 交换机 | 通信经过 OVS；清除转发规则后通信中断 |
| P2 单网络 | 一个 Worker 管理约 10 个节点 | 自动创建、状态检查、业务验证、定向回收成功 |
| P3 双网络 | 两个 Worker，各 10–20 个节点，至少一条跨网络链路 | 单控制器看到两组交换机；启动前安装规则，跨网络通信成功 |
| P4 同机隔离 | 独立资源标签、重启和清理 | 重启/停止 A 不删除 B 的节点或 OVS 状态 |
| P5 隧道和多机准备 | VXLAN 小样例、部署映射切换 | 同机隧道可运行；真实跨机验收待第二台主机可用 |
| P6 实验记录 | 配置、版本、指标及抓包归档 | 重复创建与停止结果可核对，能定位业务实际路径 |

P0/P1 是选型验证，尤其检验 DockerOVSSwitch 与框架的适配，不把“已有 Containernet”当作全部功能已具备。性能数据在实施后采集；不预先承诺创建时间和内存消耗。

采集：节点创建、链路创建、交换机连接和流表准备时间；容器与主机内存；指定业务对的往返时延、TCP/UDP 吞吐与丢包；控制器消息数；停止后资源残留。扩大性能测试应由已有测量结果决定。

## 9. 当前无需继续确认的事项

本方案已经能够作为第一版开发基线。当前没有访问用户的 Windows/WSL 或原生 Linux 环境，不能声称完成兼容性验证。实际开始部署时再收集机器 CPU、内存、系统版本与连接方式，并完成 P0。

单机 Linux 足以开始，不要求立即提供两台机器。第一版建议先实现 Docker 节点与单控制器正确转发，再封装 Worker 镜像，最后迁移到真正多机。若原生 Linux 暂不可用，保留 Docker Desktop 环境能力验证分支；不直接承诺所有命名空间与内核操作都可复用。

## 10. 参考依据

以下资料支持部署机制与现有工具能力；本方案中的组件划分、默认路由及分阶段验收是针对本项目的设计建议。

- [Docker Desktop WSL2 后端](https://docs.docker.com/desktop/features/wsl/)：Docker 后端与 WSL 发行版的关系。
- [Docker host 网络模式](https://docs.docker.com/engine/network/drivers/host/)：Linux 与 Desktop 的支持及限制。
- [OVS 安装与内核要求](https://docs.openvswitch.org/en/stable/intro/install/general/)：内核数据通路需要兼容内核支持。
- [Microsoft WSL 配置](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)：自定义内核和内核模块配置。
- [Containernet](https://github.com/containernet/containernet)：Docker 主机、管理程序容器化部署，以及该部署方式的资源限制说明。
- [Containernet Docker 主机示例](https://github.com/containernet/containernet/blob/master/examples/dockerhosts.py)：Docker 主机与 OVSSwitch 的使用方式。
- [Linux 网络命名空间](https://www.man7.org/linux/man-pages/man7/network_namespaces.7.html)：接口、协议栈及路由表的隔离。
- [OS-Ken](https://github.com/openstack/os-ken)：Python OpenFlow 控制框架。
