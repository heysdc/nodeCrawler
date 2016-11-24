var http = require('http')
var path = require('path')
var cheerio = require('cheerio')
var fs = require('fs')
var xlsx = require('node-xlsx')
var jsonAddress = '../info.json'
var xlsxAddress = '../index.xlsx'
var info = fs.readFileSync(path.join(__dirname, jsonAddress))

// 不想抓取到的缩略图
var invalidPics = []
// 网页
var urls = []
// 摘要字数
var abstarctLength = 30
// 是否全部更新
var ifRefreshAll = false

info = JSON.parse(info)

// 不分类
// [{
//   title: '',
//   pic: '',
//   href: '',
//   abstract: ''
// }]
// 分类
// [{
//   title: '',
//   pic: '',
//   href: '',
//   abstract: '',
//   className: '类名'
// }]
var pagesInfo = info || {}

// 判断pagesInfo里什么特征的内容需要重新获取pic与摘要文字
function checkPageInfoShouldRefresh (pageInfo) {
  if (ifRefreshAll) {
    // 刷新所有数据
    return true
  } else {
    // 正常过滤
    return (!pageInfo.pic && !pageInfo.abstract)
  }
}

function checkIfRepeat (title, href) {
  return pagesInfo[title].some((val, key) => {
    if (val.href === href) {
      if (val.title.indexOf('�') < 0 && val.abstract.indexOf('�') < 0) {
        return true
      } else { // 去除�
        console.log('有一条数据存在� 再更新一次，实在不行到mobile/public/shike/info.json手动处理')
        pagesInfo[title].splice(key, 1)
        return false
      }
    }
  })
}

// 从xlsx文件中提取内容
try {
  const workSheetsFromBuffer = xlsx.parse(path.join(__dirname, xlsxAddress))[0].data.slice(1)
  var title = ''
  workSheetsFromBuffer.forEach((val, key) => {
    // 第0列分类名，第2列标题，第7列数据
    if (val[2]) { // 排除无用的数据
      // 提取分类名
      if (val[0]) {
        title = val[0]
      }
      // 没有该分类则添加
      if (!pagesInfo[title]) {
        pagesInfo[title] = []
      }
      // 判断分类内有无该项数据
      if (!checkIfRepeat(title, val[7])) {
        pagesInfo[title].push({
          title: val[2],
          href: val[7],
          fromXlsx: true
        })
      }
    }
  })
} catch (e) {
  console.log('解析xlsx文件出错', e)
}

// 从页面中提取内容
var promiseArray = urls.map((url) => {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      var html = ''
      res.on('data', (data) => {
        html += data
      })
      res.on('end', () => {
        resolve(html)
      })
    })
  })
})

Promise.all(promiseArray)
.then((posts) => {
  posts.map((post) => {
    var $ = cheerio.load(post)
    var chapters = $('#LayoutDiv1>a, #LayoutDiv1>p')
    var title = $('title').text()
    var className = ''
    // 将所有页面的内容塞到pagesInfo里
    chapters.map(function (key, val) {
      let value = $(this)
      let chapterName = value.text()
      if (chapterName[0] === '♦') {
        chapterName = chapterName.slice(1)
      }
      if (val.tagName === 'p') {
        className = chapterName
      } else {
        if (!checkIfRepeat(title, value.attr('href'))) { // 判断存不存在
          pagesInfo[title].push({
            title: chapterName,
            pic: '',
            href: value.attr('href'),
            abstract: '',
            className: className
          })
        }
      }
    })
  })
})
.then(() => {
  let promiseArray = []
  for (let i in pagesInfo) {
    pagesInfo[i].forEach((val, key) => {
      if (checkPageInfoShouldRefresh(val)) {
        promiseArray.push(new Promise((resolve) => {
          http.get(val.href, (res) => {
            var html = ''
            res.on('data', (data) => {
              html += data
            })
            res.on('end', () => {
              resolve({
                html,
                title: i,
                chapterKey: key
              })
            })
          })
        }))
      }
    })
  }
  // 将页面中提取中的url分别打开提取数据
  console.log('' + promiseArray.length + '项数据更新中')
  Promise.all(promiseArray)
  .then((posts) => {
    posts.map((post) => {
      let $ = cheerio.load(post.html)
      let imgs = $('img')
      let p = $('.rich_media_content p')
      let image = ''
      let abstractInfo = ''
      // 链接的图片内容
      imgs.each(function (key, val) {
        if (val.attribs['data-src'] && invalidPics.indexOf(val.attribs['data-src']) < 0) {
          image = val.attribs['data-src']
          return false
        }
      })
      // 链接的摘要内容
      p.each(function (key, val) {
        val = $(this)
        if (val.text().trim() && val.text().trim().length > abstarctLength) {
          abstractInfo = val.text().slice(0, abstarctLength)
          return false
        }
      })
      Object.assign(pagesInfo[post.title][post.chapterKey], {
        pic: image,
        abstract: abstractInfo
      })
    })
    // 写入json文件
    fs.writeFile(path.join(__dirname, jsonAddress), JSON.stringify(pagesInfo), (error) => {
      if (error) {
        console.log('写入当前目录info.json文件失败', error)
      } else {
        console.log('成功！')
      }
    })
  })
})
.catch((e) => {
  console.log('出错了！', e)
})
