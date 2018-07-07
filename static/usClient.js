'use strict';

(function () {
  let myself = null;

  function formatForumPost (data) {
    return '<div class="post">' +
      '<div class="info">' +
      '<div class="msgId">' + data.id + '</div>' +
      '<div class="msgAuthor">' + data.username + '</div>' +
      '<div class="msgTs">' + data.ts + '</div>' +
      '<div class="msgText">' + data.message + '</div>' +
      '</div>' +
      '</div>'
  }

  $('#login').submit(function (event) {
    event.preventDefault();

    $.ajax({
      method: 'POST',
      url: 'api/login',
      data: {user: $('#login input.user').val(), pw: $('#login input.pw').val()},
      dataType: 'JSON',
    })
      .done(function (data) {
        myself = data;
      })
  });

  $('#addFriend').submit(function (event) {
    event.preventDefault();

    if (!myself) {
      $('#addFriend .info').text('Not authenticated');
      return;
    }

    let friendName = $('#addFriend input:first').val();
    if (!friendName) {
      $('#addFriend .info').text('Missing friend name');
      return
    }

    $.ajax({
      method: 'GET',
      url: 'api/addFriend',
      data: {ownId: myself.id, otherName: friendName},
      dataType: 'JSON'
    })
      .done(function (data) {
        $('#addFriend .info').text('success');
      })
      .fail(function (xhr, status, error) {
        $('#addFriend .info').text(status);
      });
  });

  $('#loadFriends').click(function () {
    if (!myself) {
      alert('Not authenticated!');
      return;
    }

    $.ajax({
      method: 'GET',
      url: 'api/getFriends/' + myself.id,
      dataType: 'JSON'
    })
      .done(function (data) {
        let tbody = '';
        data.forEach(function (d) {
          tbody += '<tr>';
          tbody += '<td>' + d.name + '</td>';
          tbody += '<td>' + d.mail + '</td>';
          tbody += '<td>' + d.age + '</td>';
          tbody += '</tr>';
        });

        $('#friendList > tbody').html(tbody);
      })
  });

  $('#postMsg').click(function () {
    let msg = $('#newMsg').val();
    $.ajax({
      method: 'POST',
      url: 'api/addMessage',
      data: JSON.stringify({message: msg}),
      contentType: 'application/json',
      dataType: 'JSON'
    })
      .done(function (data) {
        $('#forum div:last').append(formatForumPost(data))
      })
      .fail(function (xhr, status) {
        $('#newMsg .info').text('Failed: ' + status);
      })
  });

  // the onLoad trigger
  $(function () {
    $.ajax({
      method: 'GET',
      url: 'api/ownInfo',
      dataType: 'JSON',
    })
      .done(function (data) {
        myself = data;
      });

    $.ajax({
      method: 'GET',
      url: 'api/messages',
      dataType: 'JSON'
    })
      .done(function (data) {
        let forumHtml = '';
        data.forEach(function (entry) {
          forumHtml += formatForumPost(entry)
        });
        $('#forum').html(forumHtml);
      });
  })

})();