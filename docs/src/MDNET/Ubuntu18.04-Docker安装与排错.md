# VMware 中 Ubuntu 18.04 Server 安装 Docker：安装流程与网络排错

本文记录在 Windows 宿主机、VMware 虚拟机和 Ubuntu 18.04 Server 环境中安装 Docker 的流程，以及控制台无法粘贴、Docker Hub 连接超时、Windows 代理端口拒绝连接等问题的排查方法。

本次环境中，Docker Engine 24.0.2 和 Docker Compose 2.18.1 已安装成功，Docker 服务正常运行；镜像下载仍未验证成功。排查 Windows 代理端口后，后续选择取消此前的代理配置，改用 DaoCloud 镜像加速。下文将已经验证的结果和待执行、待验证的步骤分别说明。

## 一、安装流程

整体流程为：通过 SSH 登录虚拟机 → 更换 Ubuntu 软件源 → 添加 Docker 软件源 → 安装并启动 Docker → 验证服务 → 验证镜像下载与容器运行。

### 1. 建立 SSH 连接

Ubuntu Server 默认使用命令行界面。在 VMware 控制台中无法直接粘贴长命令时，可以从 Windows 使用 SSH（远程登录协议）连接虚拟机，之后在 Windows 终端中复制粘贴。

在 Ubuntu 控制台中手动输入：

```bash
sudo apt install openssh-server
sudo systemctl enable --now ssh
hostname -I
whoami
```

后两条命令分别用于查看虚拟机 IP 和当前用户名。

本次虚拟机地址为 `192.168.145.132`，用户名为 `csp`。在 Windows PowerShell 中执行：

```powershell
ssh csp@192.168.145.132
```

首次连接时，确认目标 IP 是自己的虚拟机，再接受主机指纹提示并输入 Ubuntu 用户密码。输入密码时没有字符显示属于正常现象。

登录后，命令仍在 Ubuntu 虚拟机中执行。Windows Terminal 通常可使用 `Ctrl+Shift+V` 粘贴，传统 PowerShell 窗口可尝试右键粘贴。

### 2. 更换 Ubuntu 软件源

本次先尝试了阿里云源，随后改用清华源。这里给出最终使用的清华源配置。

Ubuntu 18.04 的发行版代号是 `bionic`，软件源配置文件为 `/etc/apt/sources.list`。

先备份：

```bash
sudo cp -a /etc/apt/sources.list "/etc/apt/sources.list.backup.$(date +%Y%m%d-%H%M%S)"
```

写入清华源：

```bash
sudo tee /etc/apt/sources.list > /dev/null <<'EOF'
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ bionic main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ bionic-updates main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ bionic-security main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ bionic-backports main restricted universe multiverse
EOF

sudo apt-get update
```

这一步只更新软件包索引，不升级已安装的软件。Ubuntu 官方安全更新源也被替换为镜像地址，因此更新可用时间受镜像同步进度影响。

### 3. 添加 Docker 软件源

Ubuntu 18.04 已不在 Docker 当前官方支持范围内。官方仍保留其历史软件包，本次安装使用这些包。新建环境可优先使用受支持的 Ubuntu 版本；以下命令适用于需要保留 Ubuntu 18.04 的环境。

全新系统先安装依赖：

```bash
sudo apt-get install -y ca-certificates curl gnupg
```

如果之前安装过 `docker.io`、`docker-compose`、`containerd` 或 `runc`，需要先处理与 Docker 官方包的冲突。已有服务依赖这些包时，应评估卸载影响；全新系统无需执行卸载。

添加 Docker 官方签名密钥：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /tmp/docker-key.asc
sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg /tmp/docker-key.asc
sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

密钥下载失败时，先排查下载问题，不要继续添加软件源。

添加 `bionic` 软件源：

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu bionic stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
```

Ubuntu 软件源与 Docker 软件源是独立配置。更换清华 Ubuntu 源不会自动修改上述 Docker 官方源。

### 4. 安装并启动 Docker

查看软件源中的可用版本：

```bash
apt-cache madison docker-ce
```

安装 Docker Engine、命令行工具、容器运行组件及插件：

```bash
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

`enable --now` 同时设置开机启动并立即启动服务。

查看版本：

```bash
sudo docker version
sudo docker compose version
```

本次实际输出中的版本为：

| 组件 | 版本 |
| --- | --- |
| Docker Engine | 24.0.2 |
| Docker Compose | 2.18.1 |
| containerd | 1.6.21 |
| runc | 1.1.7 |

`docker version` 同时显示 `Client` 和 `Server`，说明客户端已安装，且能够连接 Docker 后台服务。

### 5. 验证镜像下载与容器运行

```bash
sudo docker run --rm hello-world
```

该命令会在本地没有镜像时先下载镜像，再创建并运行测试容器。`--rm` 表示容器退出后自动删除该容器，镜像仍然保留。

正常完成时会输出：

```text
Hello from Docker!
```

本次未到达这个结果，具体报错及处理方法见下一部分。

## 二、问题与解决过程

### 1. VMware 控制台无法粘贴命令

Ubuntu Server 的命令行控制台与桌面终端的剪贴板交互方式不同。实际操作中无法直接粘贴长命令，因此采用 Windows SSH 终端进行管理。

处理步骤是：在虚拟机中安装并启动 SSH 服务，查看 IP 和用户名，再从 Windows PowerShell 登录。后续换源、安装 Docker 和排查网络均可在 SSH 会话中执行。

### 2. 本地找不到 hello-world 镜像

首次运行测试命令时，出现：

```text
Unable to find image 'hello-world:latest' locally
```

这条消息本身不是安装失败。它只表示本地没有该镜像，Docker 将继续尝试从镜像仓库下载。应结合后续输出判断是否成功。

### 3. Docker Hub 连接超时

后续报错为：

```text
docker: Error response from daemon: Get "https://registry-1.docker.io/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers).
```

报错发生在 Docker 服务访问 Docker Hub 的过程中。它说明访问超时，但不能仅凭这段输出确定是 DNS、网络路由、防火墙还是外部网络限制导致。

这里需要区分三类访问：

| 操作 | 访问目标 | 相关配置 |
| --- | --- | --- |
| 安装 Ubuntu 软件包 | Ubuntu 软件仓库 | `/etc/apt/sources.list` |
| 安装 Docker 软件包 | Docker 软件仓库 | `/etc/apt/sources.list.d/docker.list` |
| 下载容器镜像 | Docker Hub 等镜像仓库 | Docker 服务的代理或镜像仓库配置 |

因此，将 Ubuntu apt 源换成清华源，不能解决 Docker Hub 的连接超时。对此可以采用两种方式：为 Docker 服务配置可用的网络代理，或者配置 Docker Hub 镜像加速服务。本次先排查了 Windows 代理，之后选择切换到 DaoCloud；具体切换命令见第 7 节。

清华的 Docker CE 软件源提供 Docker 安装包，不提供 Docker Hub 容器镜像加速。DaoCloud 提供公共镜像加速服务，但有镜像白名单和限流，主要面向中国大陆访问；能否下载指定镜像，应以实际测试为准。

### 4. Windows 代理端口拒绝连接

Ubuntu 的网卡地址为：

```text
ens33: 192.168.145.132/24
docker0: 172.17.0.1/16
```

`ens33` 是虚拟机用于访问外部网络的网卡；`docker0` 是 Docker 创建的默认网桥。

使用 `192.168.145.1:7890` 作为候选 Windows 代理地址进行测试：

```bash
curl -I --connect-timeout 10 -x http://192.168.145.1:7890 https://registry-1.docker.io/v2/
```

返回：

```text
curl: (7) Failed to connect to 192.168.145.1 port 7890: Connection refused
```

随后执行：

```bash
ping 192.168.145.1
```

能够收到响应。这说明该地址可达，但其 TCP 7890 端口没有接受连接。常见原因包括：代理未启动、端口填写错误、代理只监听本机回环地址，或者防火墙主动拒绝连接。

`192.168.145.1` 是否属于 Windows 的 VMware 虚拟网卡，仍需在 Windows 中确认；`7890` 也只是候选端口，不能据此认定代理实际使用它。

另外，下面的命令不能测试端口：

```text
ping 192.168.145.1:7890
```

`ping` 使用 ICMP 协议，不使用 TCP 端口。测试代理应使用带 `-x` 参数的 `curl`。

### 5. 后续处理：确认 Windows 的地址与代理监听

在 Windows PowerShell 中执行：

```powershell
ipconfig
```

若 VMware 使用默认 NAT 配置，查看 `VMware Network Adapter VMnet8` 的 IPv4 地址。默认网关地址与 Windows 虚拟网卡地址可能不同，不应直接把网关当成代理地址。

再检查候选代理端口：

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object LocalPort -eq 7890 |
  Format-Table LocalAddress,LocalPort,OwningProcess
```

| 输出 | 处理方法 |
| --- | --- |
| 没有输出 | 检查代理是否启动，以及实际 HTTP/Mixed 端口 |
| `127.0.0.1` 或 `::1` | 只监听 Windows 本机；开启代理软件的“允许局域网连接” |
| `0.0.0.0` 或 Windows 的 VMnet8 IPv4 地址 | 检查 Windows 防火墙是否允许虚拟机访问代理程序 |

Mixed 端口指同时支持 HTTP 和 SOCKS 代理协议的端口。本文的 `http://` 配置需要代理端口支持 HTTP 代理。

地址和端口确认后，再从 Ubuntu 重试 `curl`。如果直接收到仓库的 `401 Unauthorized` 响应，通常表示已到达需要认证的仓库接口；HTTP CONNECT 代理返回的 `200 Connection established` 本身只说明隧道已建立，应继续观察后续仓库响应。

### 6. 后续处理：配置 Docker 服务使用代理

代理连通性测试通过后，再配置 Docker。下面假设经过确认的 Windows 地址为 `192.168.145.1`，HTTP/Mixed 端口为 `7890`；实际使用时必须替换成自己的值。

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/http-proxy.conf > /dev/null <<'EOF'
[Service]
Environment="HTTP_PROXY=http://192.168.145.1:7890"
Environment="HTTPS_PROXY=http://192.168.145.1:7890"
Environment="NO_PROXY=localhost,127.0.0.1,::1"
EOF
```

这里使用 systemd 的服务补充配置，为 Docker 后台服务设置代理环境变量。仅在 SSH 终端执行 `export HTTP_PROXY=...`，不会自动改变已经运行的 Docker 服务环境。

虽然目标仓库使用 HTTPS，`HTTPS_PROXY` 的值仍可以是 `http://...`，这里描述的是连接代理所使用的协议。

加载配置并重启服务：

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
sudo systemctl show --property=Environment docker
```

重启会影响正在运行的容器，已有业务容器时需要安排合适的操作时间。

最后验证：

```bash
sudo docker pull hello-world
sudo docker run --rm hello-world
```

如果继续采用代理方式，使用上述配置；如果选择 DaoCloud，按下一节撤销本文添加的代理并切换镜像加速服务。

### 7. 取消 Docker 代理，切换到 DaoCloud 镜像加速

本节全部使用终端命令和编辑器操作，不使用 Python 脚本。

#### 7.1 删除此前的代理配置

在 Ubuntu 中执行：

```bash
sudo rm -f /etc/systemd/system/docker.service.d/http-proxy.conf
sudo systemctl daemon-reload
```

这一步仅删除本文通过 systemd 添加的代理文件。如果曾在其他 systemd 配置或 `daemon.json` 中添加代理，还需要检查并移除对应设置。

#### 7.2 备份并编辑 Docker 配置

如果 `/etc/docker/daemon.json` 已存在，先备份。下面使用时间戳命名备份，避免覆盖之前的备份：

```bash
sudo cp -a /etc/docker/daemon.json "/etc/docker/daemon.json.backup.$(date +%Y%m%d-%H%M%S)"
```

如果该文件尚不存在，跳过备份。创建目录并打开配置文件：

```bash
sudo mkdir -p /etc/docker
sudo nano /etc/docker/daemon.json
```

文件为空时，填入：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io"
  ]
}
```

如果已有其他配置，保留原来的设置，仅添加或替换 `registry-mirrors` 字段。JSON 对象中不同字段之间需要逗号，最后一个字段后不能添加逗号。

例如，已有日志配置时，可合并为：

```json
{
  "log-driver": "json-file",
  "registry-mirrors": [
    "https://docker.m.daocloud.io"
  ]
}
```

在 nano 中按 `Ctrl+O`、回车保存，再按 `Ctrl+X` 退出。

#### 7.3 验证配置并重启

先验证：

```bash
sudo dockerd --validate --config-file=/etc/docker/daemon.json
```

只有验证通过后才重启；如果报错，先修正配置文件：

```bash
sudo systemctl restart docker
```

#### 7.4 检查生效情况并测试镜像

```bash
sudo systemctl show --property=Environment docker
sudo docker info
sudo docker run --rm hello-world
```

检查服务环境中是否已移除此前设置的 `HTTP_PROXY` 和 `HTTPS_PROXY`；同时检查 `docker info` 的 `Registry Mirrors` 是否包含 `https://docker.m.daocloud.io`。若 `docker info` 仍显示代理，说明还有其他代理配置来源。

运行测试容器并输出 `Hello from Docker!`，才表示本次容器测试成功。如果镜像此前已下载到本地，这次运行不会验证镜像加速下载路径。

镜像加速服务失败时，Docker 可能继续尝试原始 Docker Hub；因此最终报错仍显示 `registry-1.docker.io`，不一定意味着配置没有加载。可以使用 DaoCloud 官方推荐的镜像名称前缀方式，单独测试该服务：

```bash
sudo docker pull m.daocloud.io/docker.io/library/hello-world:latest
sudo docker run --rm m.daocloud.io/docker.io/library/hello-world:latest
```

上述操作属于待执行、待验证的后续方案。本文已经确认的结果仍是 Docker 软件和服务正常、Windows 候选地址可达、代理端口拒绝连接；尚未取得 DaoCloud 镜像拉取成功的输出。

## 参考资料

- [Docker 官方 Ubuntu 安装文档](https://docs.docker.com/engine/install/ubuntu/)
- [Docker 官方 Ubuntu 18.04 历史软件包](https://download.docker.com/linux/ubuntu/dists/bionic/pool/stable/amd64/)
- [Docker 后台服务代理配置](https://docs.docker.com/engine/daemon/proxy/)
- [Docker 镜像仓库认证机制](https://docs.docker.com/reference/api/registry/auth/)
- [Docker Hub 镜像加速配置](https://docs.docker.com/docker-hub/image-library/mirror/)
- [DaoCloud 公共镜像服务](https://github.com/DaoCloud/public-image-mirror)
- [DaoCloud 白名单与限流说明](https://github.com/DaoCloud/public-image-mirror/issues/2328)
- [Ubuntu OpenSSH 服务文档](https://ubuntu.com/server/docs/how-to/security/openssh-server/)
- [清华 Ubuntu 镜像使用帮助](https://mirrors.tuna.tsinghua.edu.cn/help/ubuntu/)
