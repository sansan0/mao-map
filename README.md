<div align="right">

[English](README_EN.md) | 中文

</div>

<div align="center">

# 📍 跟着教员走遍中国 - 毛主席足迹地图

[![PC端访问](https://img.shields.io/badge/PC端-支持-4285F4?style=flat-square&logo=windows&logoColor=white)](#)
[![移动端访问](https://img.shields.io/badge/移动端-支持-4285F4?style=flat-square&logo=android&logoColor=white)](#)
[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-在线访问-4285F4?style=flat-square&logo=github&logoColor=white)](https://sansan0.github.io/mao-map)
[![Windows 桌面版](https://img.shields.io/badge/Windows-桌面版下载-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/sansan0/mao-map/releases/latest)
[![macOS 桌面版](https://img.shields.io/badge/macOS-桌面版下载-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/sansan0/mao-map/releases/latest)

</div>

> 读万卷书，行万里路

本项目通过数据可视化的力量，将毛泽东主席自 1893 年至 1976 年波澜壮阔的一生，浓缩于一张可交互的动态地图之上。让那段恢弘的历史"活"起来，清晰、生动地展现伟人在中国历史洪流中的每一个关键抉择与地理印记。

**在线体验：[https://sansan0.github.io/mao-map/](https://sansan0.github.io/mao-map/)**

**桌面版下载：[GitHub Releases](https://github.com/sansan0/mao-map/releases/latest)**（Windows 安装包 / macOS DMG）

<p align="center">
  <img src="docs/images/image.png" alt="电脑效果" />
</p>

## 🎯 核心功能

### 🎬 动态历史

- **时间轴播放**：点击 ▶️ 播放按钮，按时间顺序观看毛主席 83 年的人生轨迹动画
- **时间定位**：拖动底部的时间轴，可以快速定位到特定年份，查看当时的活动

### 🗺️ 交互式地图

- **多层级标记**：根据访问次数和事件类型智能显示不同样式的地图标记
- **详情面板**：点击地图上任意标记，查看该地点的完整历史事件列表
- **路径高亮**：点击事件列表项可高亮显示对应的移动路径

### 📊 数据统计

- **实时统计**：动态显示移动次数、访问省市、国际移动等数据
- **进度追踪**：实时显示当前播放进度、年龄、事件序号等信息
- **可视化图表**：直观展示历史轨迹的统计信息

### 🖥️ 桌面客户端

基于 Tauri v2 构建，支持 Windows 和 macOS：

- **系统托盘**：关闭窗口自动收入托盘，右键菜单支持置顶显示、开机启动
- **智能镜头跟随**：三种模式可选 —— 智能（距离自适应）、沿路（缓缓跟随路径）、关闭
- **统一速度控制**：单一速度档位同时控制播放、路径动画和镜头跟随
- **设置持久化**：语言、置顶、开机启动等偏好自动保存

### PC 端快捷键

- **空格键**：播放 / 暂停
- **← / →**：前一个 / 后一个事件
- **Home / End**

## 💖 星星之火

无论你是发现了一个错误日期，还是想补充一段被遗漏的足迹，你的每一次贡献，都在让历史画卷更加完整。

感谢诸位同志为项目的完善做出的贡献：

<div align="center">
<table>
  <tr>
    <td align="center" width="150">
      <a href="https://github.com/sansan0/mao-map/issues?q=author:troilus">
        <img src="https://github.com/troilus.png?size=64" width="64"/><br/>
        <sub>@troilus</sub>
      </a>
    </td>
    <td align="center" width="150">
      <a href="https://github.com/sansan0/mao-map/issues?q=author:9E307">
        <img src="https://github.com/9E307.png?size=64" width="64"/><br/>
        <sub>@9E307</sub>
      </a>
    </td>
    <td align="center" width="150">
      <a href="https://github.com/sansan0/mao-map/issues?q=author:DoWhat6">
        <img src="https://github.com/DoWhat6.png?size=64" width="64"/><br/>
        <sub>@DoWhat6</sub>
      </a>
    </td>
  </tr>
</table>
</div>

每个考据者都可以在自己的考据中留下你对该事件的 comment, 你可以在 issues 中提交，由项目作者进行录入，以后考据的人多了，评论多了，我会做成弹幕在地图上滚动

```json
"userVerification": [
  // 支持多人协同考据
  {
    "username": "湘江史话", // 考据者署名 (可选)
    "comment": "一个注定将改变中华民族命运的伟人在韶山冲的农家小院中诞生。此时的中国正值内忧外患，列强瓜分，民族危亡之际。这个婴儿的啼哭声，仿佛是历史的回响，预示着一个新时代的到来。从韶山走向天安门，从农家子弟到开国领袖，毛泽东的一生将与中国人民的解放事业紧密相连，书写出波澜壮阔的历史篇章。", // 考据补充或感言 (可选)
    "date": "2025-06-30" // 考据日期 (可选)
  }
]
```

## 🚀 快速开始

想要贡献或查看详细的参与方式？请查看 [贡献指南](CONTRIBUTING.md)。

## 📞 交流与联系

- **提交贡献/BUG**：请统一通过 [GitHub Issues](https://github.com/sansan0/mao-map/issues) 提交，这是追踪和处理问题最高效的方式。
- **交流与讨论**：欢迎关注公众号 **【硅基茶水间】**，分享你的想法。

![公众号二维码](https://raw.githubusercontent.com/sansan0/sansan0/refs/heads/master/_image/weixin.png)

## 🌟 项目愿景

**"古为今用"**，希望这个工具能成为大家学习历史、理解历史的得力助手。

## 📄 开源协议

本项目采用 [GPL-3.0 License](LICENSE) 协议开源，欢迎一切形式的分享与二次创作。
